import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { StoreError } from "@local-resume/store/errors";
import { RESUME_ID_PATTERN, type FileResumeStore } from "@local-resume/store/file-store";
import { MAX_PDF_BYTES } from "@local-resume/store/pdf-export-store";
import type { PdfExportStore } from "@local-resume/store/pdf-export-store";
import type { StoredResume } from "@local-resume/store/types";
import { ResumeChangeHub } from "./file-events";

/** JSON documents are capped at 10 MiB before any parsing or writing happens. */
export const MAX_JSON_BYTES = 10 * 1024 * 1024;

export type StudioServerOptions = {
	/** The single local UI origin allowed to mutate data. */
	allowedOrigin: string;
};

export type StudioRequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

type ApiErrorCode =
	| "BAD_REQUEST"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "CONFLICT"
	| "UNSUPPORTED_MEDIA_TYPE"
	| "PAYLOAD_TOO_LARGE"
	| "METHOD_NOT_ALLOWED"
	| "INTERNAL_ERROR";

type ResponseHeaders = Record<string, string | number>;

class HttpError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;

	constructor(status: number, code: ApiErrorCode, message: string) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.code = code;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const headerValue = (value: string | string[] | undefined): string | undefined =>
	Array.isArray(value) ? value[0] : value;

const quoteEtag = (etag: string): string => `"${etag}"`;

const decodeResumeId = (raw: string): string => {
	try {
		return decodeURIComponent(raw);
	} catch {
		throw new HttpError(400, "BAD_REQUEST", "Resume ID is not valid URL encoding.");
	}
};

const requireIfMatch = (request: IncomingMessage): string => {
	const header = headerValue(request.headers["if-match"]);
	if (header === undefined || header.trim() === "") {
		throw new HttpError(400, "BAD_REQUEST", "If-Match is required for this mutation.");
	}

	const tag = header.trim();

	// A weak validator cannot satisfy the strong If-Match precondition. Do not let it match the
	// content hash after stripping the W/ prefix.
	if (/^W\//i.test(tag)) {
		throw new HttpError(409, "CONFLICT", "If-Match requires a strong ETag.");
	}

	let strongTag = tag;
	if (strongTag.startsWith('"') && strongTag.endsWith('"')) strongTag = strongTag.slice(1, -1);

	if (strongTag === "") {
		throw new HttpError(400, "BAD_REQUEST", "If-Match must contain a resume ETag.");
	}

	return strongTag;
};

const mediaTypeOf = (request: IncomingMessage): string => {
	const header = headerValue(request.headers["content-type"]) ?? "";
	return header.split(";")[0]?.trim().toLowerCase() ?? "";
};

const requireMediaType = (request: IncomingMessage, expected: string): void => {
	if (mediaTypeOf(request) !== expected) {
		throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", `This route requires ${expected}.`);
	}
};

const drainRequest = (request: IncomingMessage): void => {
	// Keep a listener attached while draining so a client abort cannot become an unhandled stream error.
	request.on("error", () => undefined);
	request.resume();
};

const readBody = (request: IncomingMessage, limit: number): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const declared = headerValue(request.headers["content-length"]);
		if (declared !== undefined) {
			const declaredBytes = Number(declared);
			if (Number.isFinite(declaredBytes) && declaredBytes > limit) {
				drainRequest(request);
				reject(new HttpError(413, "PAYLOAD_TOO_LARGE", `Request bodies are limited to ${limit} bytes.`));
				return;
			}
		}

		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;

		const cleanup = (): void => {
			request.off("data", onData);
			request.off("end", onEnd);
			request.off("error", onError);
			request.off("aborted", onAborted);
		};

		const settle = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};

		const onData = (chunk: Buffer): void => {
			size += chunk.length;
			if (size > limit) {
				// Stop buffering immediately, then drain the rest so the client can still read the 413.
				request.pause();
				settle(() => {
					drainRequest(request);
					reject(new HttpError(413, "PAYLOAD_TOO_LARGE", `Request bodies are limited to ${limit} bytes.`));
				});
				return;
			}

			chunks.push(chunk);
		};

		const onEnd = (): void => {
			settle(() => resolve(Buffer.concat(chunks)));
		};

		const onError = (error: Error): void => {
			settle(() => reject(error));
		};

		const onAborted = (): void => {
			settle(() => reject(new HttpError(400, "BAD_REQUEST", "The request body was interrupted.")));
		};

		request.on("data", onData);
		request.on("end", onEnd);
		request.on("error", onError);
		request.on("aborted", onAborted);
	});

const readJson = async (request: IncomingMessage): Promise<unknown> => {
	const body = await readBody(request, MAX_JSON_BYTES);
	if (body.byteLength === 0) {
		throw new HttpError(400, "BAD_REQUEST", "A JSON request body is required.");
	}

	try {
		return JSON.parse(body.toString("utf8")) as unknown;
	} catch {
		throw new HttpError(400, "BAD_REQUEST", "Request body is not valid JSON.");
	}
};

const sendJson = (
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: ResponseHeaders = {},
): void => {
	if (response.writableEnded) return;

	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		...headers,
	});
	response.end(payload);
};

const sendNoContent = (response: ServerResponse): void => {
	if (response.writableEnded) return;
	response.writeHead(204, {
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end();
};

const sendPdf = (response: ServerResponse, pdf: Uint8Array, filename: string): void => {
	if (response.writableEnded) return;

	const bytes = Buffer.from(pdf);
	const safeFilename = filename.replace(/["\r\n]/g, "_");

	response.writeHead(200, {
		"Content-Type": "application/pdf",
		"Content-Length": bytes.byteLength,
		"Content-Disposition": `attachment; filename="${safeFilename}"`,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(bytes);
};

const openChangeStream = (
	request: IncomingMessage,
	response: ServerResponse,
	resumeId: string,
	changes: ResumeChangeHub,
): void => {
	response.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-store",
		Connection: "keep-alive",
		"X-Content-Type-Options": "nosniff",
	});

	// Flush the response headers and establish the stream before any filesystem event can arrive.
	response.write(": connected\n\n");

	let unregisterStream: (() => void) | undefined;
	let heartbeat: NodeJS.Timeout | undefined;
	let closed = false;

	const cleanup = (): void => {
		if (closed) return;
		closed = true;
		if (heartbeat !== undefined) clearInterval(heartbeat);
		unsubscribe();
		unregisterStream?.();
		if (!response.writableEnded) response.end();
	};

	const unsubscribe = changes.subscribe(resumeId, (event) => {
		if (closed || response.writableEnded) return;
		response.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
	});
	unregisterStream = changes.registerStream(cleanup);

	// Keep intermediaries from closing an idle local stream; the timer is cleared on every teardown path.
	heartbeat = setInterval(() => {
		if (closed || response.writableEnded) {
			cleanup();
			return;
		}
		response.write(": keep-alive\n\n");
	}, 15_000);
	heartbeat.unref();

	request.on("close", cleanup);
	request.on("error", cleanup);
	response.on("close", cleanup);
	response.on("error", cleanup);
};

const sendError = (response: ServerResponse, error: HttpError, headers: ResponseHeaders = {}): void => {
	if (response.writableEnded) return;
	if (response.headersSent) {
		response.destroy();
		return;
	}

	sendJson(
		response,
		error.status,
		{
			error: {
				code: error.code,
				message: error.message,
			},
		},
		headers,
	);
};

const methodNotAllowed = (response: ServerResponse, allow: string): void => {
	sendError(response, new HttpError(405, "METHOD_NOT_ALLOWED", `Method not allowed. Use ${allow}.`), {
		Allow: allow,
	});
};

const toHttpError = (error: unknown): HttpError => {
	if (error instanceof HttpError) return error;

	if (error instanceof StoreError) {
		// Store messages can contain absolute paths and filesystem detail. Every client-facing
		// mapping uses a stable message instead of forwarding error.message.
		switch (error.code) {
			case "INVALID_ID":
				return new HttpError(400, "BAD_REQUEST", "The resume ID is invalid.");
			case "INVALID_DATA":
				return new HttpError(400, "BAD_REQUEST", "The resume data is invalid.");
			case "INVALID_PDF":
				return new HttpError(400, "BAD_REQUEST", "The PDF data is invalid.");
			case "UNSAFE_PATH":
				return new HttpError(400, "BAD_REQUEST", "The resume path is not allowed.");
			case "NOT_FOUND":
				return new HttpError(404, "NOT_FOUND", "The requested resume was not found.");
			case "EXISTS":
				return new HttpError(409, "CONFLICT", "A resume with this label already exists.");
			case "CONFLICT":
				return new HttpError(409, "CONFLICT", "The resume changed on disk since it was read.");
			case "IO_ERROR":
				return new HttpError(500, "INTERNAL_ERROR", "The local storage operation failed.");
		}
	}

	// Never expose unexpected errors or stack traces to the local client.
	return new HttpError(500, "INTERNAL_ERROR", "The local server could not complete the request.");
};

const assertOrigin = (request: IncomingMessage, mutation: boolean, allowedOrigin: string): void => {
	const rawOrigin = request.headers.origin;
	const origins = rawOrigin === undefined ? [] : Array.isArray(rawOrigin) ? rawOrigin : [rawOrigin];

	if (origins.length === 0) {
		if (mutation) {
			throw new HttpError(
				403,
				"FORBIDDEN",
				"An Origin header matching the local studio origin is required for mutations.",
			);
		}
		return;
	}

	// Reject the request if any supplied Origin differs from the one local studio origin.
	if (origins.some((origin) => origin !== allowedOrigin)) {
		throw new HttpError(403, "FORBIDDEN", "Requests must come from the local studio origin.");
	}
};

const parsePathname = (request: IncomingMessage): string => {
	try {
		return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
	} catch {
		throw new HttpError(400, "BAD_REQUEST", "Request URL is invalid.");
	}
};

const handleRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
	store: FileResumeStore,
	exports: PdfExportStore,
	allowedOrigin: string,
	changes: ResumeChangeHub,
): Promise<void> => {
	const method = (request.method ?? "GET").toUpperCase();
	const mutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

	assertOrigin(request, mutation, allowedOrigin);
	const pathname = parsePathname(request);

	if (pathname === "/api/health") {
		if (method !== "GET") {
			methodNotAllowed(response, "GET");
			return;
		}

		sendJson(response, 200, { status: "ok" });
		return;
	}

	if (pathname === "/api/resumes") {
		if (method === "GET") {
			sendJson(response, 200, { resumes: await store.list() });
			return;
		}

		if (method === "POST") {
			requireMediaType(request, "application/json");
			const body = await readJson(request);

			if (!isRecord(body) || typeof body.label !== "string" || !("data" in body)) {
				throw new HttpError(400, "BAD_REQUEST", "Create requests require a label and data.");
			}

			const resume = await store.create(body.label, body.data);
			sendJson(response, 201, resume, {
				ETag: quoteEtag(resume.etag),
				Location: `/api/resumes/${resume.id}`,
			});
			return;
		}

		methodNotAllowed(response, "GET, POST");
		return;
	}

	const eventsMatch = /^\/api\/resumes\/([^/]+)\/events$/.exec(pathname);
	if (eventsMatch?.[1] !== undefined) {
		if (method !== "GET") {
			methodNotAllowed(response, "GET");
			return;
		}

		const id = decodeResumeId(eventsMatch[1]);
		if (!RESUME_ID_PATTERN.test(id)) {
			throw new HttpError(400, "BAD_REQUEST", "The resume ID is invalid.");
		}

		// Verify that the editor is subscribing to a real, currently valid resume before streaming.
		await store.read(id);
		openChangeStream(request, response, id, changes);
		return;
	}

	const exportsMatch = /^\/api\/resumes\/([^/]+)\/exports$/.exec(pathname);
	if (exportsMatch?.[1] !== undefined) {
		if (method !== "POST") {
			methodNotAllowed(response, "POST");
			return;
		}

		const id = decodeResumeId(exportsMatch[1]);
		// Verify the resume before accepting or archiving any PDF bytes.
		await store.read(id);
		requireMediaType(request, "application/pdf");
		const pdf = await readBody(request, MAX_PDF_BYTES);
		const result = await exports.save(id, pdf);

		sendPdf(response, pdf, result.filename);
		return;
	}

	const duplicateMatch = /^\/api\/resumes\/([^/]+)\/duplicate$/.exec(pathname);
	if (duplicateMatch?.[1] !== undefined) {
		if (method !== "POST") {
			methodNotAllowed(response, "POST");
			return;
		}

		const id = decodeResumeId(duplicateMatch[1]);
		requireMediaType(request, "application/json");
		const body = await readJson(request);

		if (!isRecord(body) || typeof body.label !== "string") {
			throw new HttpError(400, "BAD_REQUEST", "Duplicate requests require a label.");
		}

		const resume = await store.duplicate(id, body.label);
		sendJson(response, 201, resume, {
			ETag: quoteEtag(resume.etag),
			Location: `/api/resumes/${resume.id}`,
		});
		return;
	}

	const labelMatch = /^\/api\/resumes\/([^/]+)\/label$/.exec(pathname);
	if (labelMatch?.[1] !== undefined) {
		if (method !== "PATCH") {
			methodNotAllowed(response, "PATCH");
			return;
		}

		const id = decodeResumeId(labelMatch[1]);
		requireMediaType(request, "application/json");
		const expectedEtag = requireIfMatch(request);
		const body = await readJson(request);

		if (!isRecord(body) || typeof body.label !== "string") {
			throw new HttpError(400, "BAD_REQUEST", "Rename requests require a label.");
		}

		const resume = await store.rename(id, body.label, expectedEtag);
		sendJson(response, 200, resume, { ETag: quoteEtag(resume.etag) });
		return;
	}

	const itemMatch = /^\/api\/resumes\/([^/]+)$/.exec(pathname);
	if (itemMatch?.[1] !== undefined) {
		const id = decodeResumeId(itemMatch[1]);

		if (method === "GET") {
			const resume = await store.read(id);
			sendJson(response, 200, { resume }, { ETag: quoteEtag(resume.etag) });
			return;
		}

		if (method === "PUT") {
			requireMediaType(request, "application/json");
			const expectedEtag = requireIfMatch(request);
			const body = await readJson(request);
			const resume: StoredResume = await store.save(id, body, expectedEtag);

			sendJson(response, 200, resume, { ETag: quoteEtag(resume.etag) });
			return;
		}

		if (method === "DELETE") {
			const expectedEtag = requireIfMatch(request);
			await store.remove(id, expectedEtag);
			sendNoContent(response);
			return;
		}

		methodNotAllowed(response, "GET, PUT, DELETE");
		return;
	}

	throw new HttpError(404, "NOT_FOUND", "The requested API route does not exist.");
};

/**
 * Builds the API request handler without creating a listener. The production entry point reuses this for `/api` while
 * serving the built Vite app from the same loopback server.
 */
export type StudioRequestHandlerDependencies = {
	changes?: ResumeChangeHub;
};

export const createStudioRequestHandler = (
	store: FileResumeStore,
	exports: PdfExportStore,
	options: StudioServerOptions,
	dependencies: StudioRequestHandlerDependencies = {},
): StudioRequestHandler => {
	if (typeof options.allowedOrigin !== "string" || options.allowedOrigin.trim() === "") {
		throw new Error("A non-empty allowedOrigin is required.");
	}

	const changes = dependencies.changes ?? new ResumeChangeHub(store);

	return async (request, response) => {
		try {
			await handleRequest(request, response, store, exports, options.allowedOrigin, changes);
		} catch (error) {
			// Drain any unread body so the client can receive the error and reuse the connection.
			drainRequest(request);
			sendError(response, toHttpError(error));
		}
	};
};

/** Creates the loopback API server. Call `listen(port, "127.0.0.1")` to bind it locally. */
export const createStudioServer = (
	store: FileResumeStore,
	exports: PdfExportStore,
	options: StudioServerOptions,
): Server => {
	const changes = new ResumeChangeHub(store);
	const server = createServer(createStudioRequestHandler(store, exports, options, { changes }));
	const close = server.close.bind(server);

	// End event streams and stop the watcher before waiting for sockets, so `server.close()` cannot hang on an SSE client.
	server.close = ((callback?: (error?: Error) => void) => {
		changes.close();
		return close(callback);
	}) as Server["close"];
	server.once("close", () => changes.close());

	return server;
};
