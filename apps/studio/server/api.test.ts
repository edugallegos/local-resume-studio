import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { type IncomingHttpHeaders, type Server, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResumeStorageError } from "@local-resume/store/errors";
import { FileResumeStore } from "@local-resume/store/file-store";
import { MAX_PDF_BYTES, PdfExportStore } from "@local-resume/store/pdf-export-store";
import type { StoredResume } from "@local-resume/store/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStudioServer } from "./api";

const ALLOWED_ORIGIN = "http://127.0.0.1:3100";
const JSON_LIMIT = 10 * 1024 * 1024;
const PDF_LIMIT = MAX_PDF_BYTES;
const MIB = 1024 * 1024;

type ApiErrorBody = {
	error: {
		code: string;
		message: string;
	};
};

type RawResponse = {
	status: number;
	headers: IncomingHttpHeaders;
	body: Buffer;
};

let dataRoot: string;
let resumesDir: string;
let exportsDir: string;
let store: FileResumeStore;
let pdfStore: PdfExportStore;
let server: Server | undefined;
let baseUrl: string;

const listen = async (target: Server): Promise<string> => {
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		target.once("error", onError);
		target.listen(0, "127.0.0.1", () => {
			target.off("error", onError);
			resolve();
		});
	});

	const address = target.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected the test server to listen on a TCP port.");
	}

	return `http://127.0.0.1:${address.port}`;
};

const close = async (target: Server): Promise<void> => {
	await new Promise<void>((resolve, reject) => {
		target.close((error) => (error ? reject(error) : resolve()));
	});
};

beforeEach(async () => {
	dataRoot = await mkdtemp(join(tmpdir(), "local-resume-api-"));
	resumesDir = join(dataRoot, "resumes");
	exportsDir = join(dataRoot, "exports");
	store = new FileResumeStore(resumesDir);
	pdfStore = new PdfExportStore(exportsDir);
	const nextServer = createStudioServer(store, pdfStore, { allowedOrigin: ALLOWED_ORIGIN });
	server = nextServer;
	baseUrl = await listen(nextServer);
});

afterEach(async () => {
	if (server) await close(server);
	await rm(dataRoot, { recursive: true, force: true });
});

/** A synthetic v6.1.0 document with no personal data. */
const syntheticResume = (name = "Ada Lovelace"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = name;
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic summary for API tests.</p>";
	return data;
};

const pdfBytes = (): ArrayBuffer =>
	Uint8Array.from(new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n")).buffer;

const jsonMutationHeaders = (etag?: string): Record<string, string> => ({
	Origin: ALLOWED_ORIGIN,
	"Content-Type": "application/json",
	...(etag ? { "If-Match": etag } : {}),
});

const createResume = async (
	label = "Ada Resume",
	data = syntheticResume(),
): Promise<{ resume: StoredResume; response: Response }> => {
	const response = await fetch(`${baseUrl}/api/resumes`, {
		method: "POST",
		headers: jsonMutationHeaders(),
		body: JSON.stringify({ label, data }),
	});

	expect(response.status).toBe(201);
	const resume = (await response.json()) as StoredResume;
	return { resume, response };
};

const expectError = async (response: Response, status: number, code: string): Promise<ApiErrorBody> => {
	expect(response.status).toBe(status);
	expect(response.headers.get("content-type")).toContain("application/json");

	const body = (await response.json()) as ApiErrorBody;
	expect(Object.keys(body)).toEqual(["error"]);
	expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
	expect(body.error.code).toBe(code);
	expect(body.error.message).toEqual(expect.any(String));
	expect(JSON.stringify(body)).not.toMatch(/\n\s+at .+:\d+:\d+/);

	return body;
};

const expectRawError = (response: RawResponse, status: number, code: string): ApiErrorBody => {
	expect(response.status).toBe(status);
	expect(String(response.headers["content-type"])).toContain("application/json");

	const body = JSON.parse(response.body.toString("utf8")) as ApiErrorBody;
	expect(body.error.code).toBe(code);
	expect(body.error.message).toEqual(expect.any(String));
	expect(response.body.toString("utf8")).not.toMatch(/\n\s+at .+:\d+:\d+/);

	return body;
};

type RawRequestOptions = {
	method: string;
	path: string;
	headers?: Record<string, string>;
	body?: string | Buffer;
	chunks?: Buffer[];
	declaredLength?: number;
};

const rawRequest = (options: RawRequestOptions): Promise<RawResponse> =>
	new Promise((resolve, reject) => {
		const url = new URL(`${baseUrl}${options.path}`);
		const headers: Record<string, string | number> = { ...options.headers };

		if (options.declaredLength !== undefined) {
			headers["Content-Length"] = options.declaredLength;
		}

		const request = httpRequest(
			{
				hostname: url.hostname,
				port: url.port,
				path: `${url.pathname}${url.search}`,
				method: options.method,
				headers,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					resolve({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks),
					});
				});
			},
		);

		request.on("error", reject);

		if (options.chunks) {
			for (const chunk of options.chunks) request.write(chunk);
			request.end();
			return;
		}

		request.end(options.body);
	});

type ServerSentEvent = {
	event: string;
	data: string;
};

type EventStream = {
	response: Response;
	next: () => Promise<ServerSentEvent>;
	close: () => void;
};

const openEventStream = async (id: string): Promise<EventStream> => {
	const controller = new AbortController();
	const response = await fetch(`${baseUrl}/api/resumes/${id}/events`, {
		headers: { Origin: ALLOWED_ORIGIN },
		signal: controller.signal,
	});

	if (response.status !== 200) {
		controller.abort();
		throw new Error(`Expected an event stream, received HTTP ${response.status}.`);
	}
	if (!response.body) {
		controller.abort();
		throw new Error("Expected an event stream body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const next = async (): Promise<ServerSentEvent> => {
		const deadline = Date.now() + 5_000;

		while (Date.now() < deadline) {
			const separator = buffer.indexOf("\n\n");
			if (separator >= 0) {
				const raw = buffer.slice(0, separator);
				buffer = buffer.slice(separator + 2);

				let event = "message";
				const data: string[] = [];
				for (const line of raw.split("\n")) {
					if (line.startsWith("event:")) event = line.slice("event:".length).trim();
					if (line.startsWith("data:")) data.push(line.slice("data:".length).trim());
				}

				// Ignore SSE comments such as the initial connected frame and heartbeats.
				if (data.length > 0) return { event, data: data.join("\n") };
				continue;
			}

			const chunk = await reader.read();
			if (chunk.done) throw new Error("The event stream ended before a change arrived.");
			buffer += decoder.decode(chunk.value, { stream: true });
		}

		throw new Error("Timed out waiting for a resume change event.");
	};

	const close = (): void => {
		controller.abort();
		void reader.cancel().catch(() => undefined);
	};

	return { response, next, close };
};

/** Replaces `<id>.json` the way an editor does: write a sibling temp file, then rename it into place. */
const atomicReplaceResume = async (id: string, data: ResumeData): Promise<void> => {
	const tempPath = join(resumesDir, `.${id}.external.tmp`);
	await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	await rename(tempPath, join(resumesDir, `${id}.json`));
};

describe("createStudioServer", () => {
	describe("health and origin policy", () => {
		it("serves health without an Origin and never adds permissive CORS headers", async () => {
			const response = await fetch(`${baseUrl}/api/health`);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status: "ok" });
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
		});

		it("allows the configured same origin and originless reads", async () => {
			const sameOrigin = await fetch(`${baseUrl}/api/resumes`, {
				headers: { Origin: ALLOWED_ORIGIN },
			});

			expect(sameOrigin.status).toBe(200);
			expect(await sameOrigin.json()).toEqual({ resumes: [] });
			expect(sameOrigin.headers.get("access-control-allow-origin")).toBeNull();

			const originless = await fetch(`${baseUrl}/api/resumes`);
			expect(originless.status).toBe(200);
			expect(await originless.json()).toEqual({ resumes: [] });
		});

		it("rejects every foreign Origin on reads and health", async () => {
			for (const path of ["/api/health", "/api/resumes"]) {
				const response = await fetch(`${baseUrl}${path}`, {
					headers: { Origin: "http://foreign.example" },
				});
				await expectError(response, 403, "FORBIDDEN");
				expect(response.headers.get("access-control-allow-origin")).toBeNull();
			}
		});

		it("requires the configured Origin for mutations", async () => {
			const body = JSON.stringify({ label: "Ada Resume", data: syntheticResume() });

			const originless = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
			await expectError(originless, 403, "FORBIDDEN");

			const foreign = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: { Origin: "http://foreign.example", "Content-Type": "application/json" },
				body,
			});
			await expectError(foreign, 403, "FORBIDDEN");

			await expect(store.list()).resolves.toEqual([]);
		});
	});

	describe("resume collection", () => {
		it("creates, lists, and reads a resume with raw and quoted ETags", async () => {
			const { resume, response } = await createResume();

			expect(resume).toMatchObject({
				id: "ada-resume",
				label: "ada-resume",
				fullName: "Ada Lovelace",
			});
			expect(resume.etag).toMatch(/^[a-f0-9]{64}$/);
			expect(response.headers.get("etag")).toBe(`"${resume.etag}"`);
			expect(response.headers.get("location")).toBe(`/api/resumes/${resume.id}`);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(Number.isNaN(Date.parse(resume.updatedAt))).toBe(false);

			const listResponse = await fetch(`${baseUrl}/api/resumes`);
			expect(listResponse.status).toBe(200);
			expect(listResponse.headers.get("cache-control")).toBe("no-store");
			expect(await listResponse.json()).toEqual({
				resumes: [
					{
						id: resume.id,
						label: resume.label,
						fullName: resume.fullName,
						updatedAt: resume.updatedAt,
					},
				],
			});

			const readResponse = await fetch(`${baseUrl}/api/resumes/${resume.id}`);
			expect(readResponse.status).toBe(200);
			expect(readResponse.headers.get("etag")).toBe(`"${resume.etag}"`);
			expect(readResponse.headers.get("cache-control")).toBe("no-store");
			expect(await readResponse.json()).toEqual({ resume });
		});

		it("rejects malformed JSON, invalid payloads, collisions, and unsupported media types", async () => {
			const malformed = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: "{ not json",
			});
			await expectError(malformed, 400, "BAD_REQUEST");

			const invalidPayload = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify([]),
			});
			await expectError(invalidPayload, 400, "BAD_REQUEST");

			const missingLabel = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ data: syntheticResume() }),
			});
			await expectError(missingLabel, 400, "BAD_REQUEST");

			const invalidData = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ label: "Broken", data: { basics: { name: 42 } } }),
			});
			await expectError(invalidData, 400, "BAD_REQUEST");

			const unsupported = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "text/plain" },
				body: JSON.stringify({ label: "Ada Resume", data: syntheticResume() }),
			});
			await expectError(unsupported, 415, "UNSUPPORTED_MEDIA_TYPE");

			await createResume();
			const collision = await fetch(`${baseUrl}/api/resumes`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ label: "ada resume", data: syntheticResume() }),
			});
			await expectError(collision, 409, "CONFLICT");

			await expect(store.list()).resolves.toHaveLength(1);
		});

		it("returns 404 for missing resumes and 400 for invalid IDs", async () => {
			await expectError(await fetch(`${baseUrl}/api/resumes/missing`), 404, "NOT_FOUND");
			await expectError(await fetch(`${baseUrl}/api/resumes/UPPER`), 400, "BAD_REQUEST");
			await expectError(
				await fetch(`${baseUrl}/api/resumes/${encodeURIComponent("../outside")}`),
				400,
				"BAD_REQUEST",
			);
		});

		it("does not expose the local storage root in client-facing errors", async () => {
			const missing = await fetch(`${baseUrl}/api/resumes/missing`);
			const missingBody = await expectError(missing, 404, "NOT_FOUND");
			expect(missingBody.error.message).toBe("The requested resume was not found.");
			expect(JSON.stringify(missingBody)).not.toContain(dataRoot);
			expect(JSON.stringify(missingBody)).not.toContain(resumesDir);

			const { resume } = await createResume("Original Resume");
			await createResume("Taken Label");
			const collision = await fetch(`${baseUrl}/api/resumes/${resume.id}/label`, {
				method: "PATCH",
				headers: jsonMutationHeaders(resume.etag),
				body: JSON.stringify({ label: "Taken Label" }),
			});
			const collisionBody = await expectError(collision, 409, "CONFLICT");
			expect(collisionBody.error.message).toBe("A resume with this label already exists.");
			expect(JSON.stringify(collisionBody)).not.toContain(dataRoot);
			expect(JSON.stringify(collisionBody)).not.toContain(resumesDir);
		});
	});

	describe("resume item", () => {
		it("saves raw resume JSON with raw or quoted If-Match and reports stale conflicts", async () => {
			const { resume } = await createResume();
			const edited = syntheticResume("Ada Updated");

			const rawMatch = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(resume.etag),
				body: JSON.stringify(edited),
			});
			expect(rawMatch.status).toBe(200);
			const saved = (await rawMatch.json()) as StoredResume;
			expect(saved.data.basics.name).toBe("Ada Updated");
			expect(rawMatch.headers.get("etag")).toBe(`"${saved.etag}"`);

			const quotedMatch = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(rawMatch.headers.get("etag") ?? undefined),
				body: JSON.stringify(syntheticResume("Ada Quoted")),
			});
			expect(quotedMatch.status).toBe(200);
			const quoted = (await quotedMatch.json()) as StoredResume;
			expect(quoted.data.basics.name).toBe("Ada Quoted");

			const stale = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(resume.etag),
				body: JSON.stringify(syntheticResume("Stale Writer")),
			});
			await expectError(stale, 409, "CONFLICT");
		});

		it("rejects a weak If-Match validator without changing the stored bytes", async () => {
			const { resume } = await createResume();
			const before = await store.read(resume.id);

			const response = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(`W/"${resume.etag}"`),
				body: JSON.stringify(syntheticResume("Weak Writer")),
			});
			await expectError(response, 409, "CONFLICT");

			const after = await store.read(resume.id);
			expect(after.etag).toBe(before.etag);
			expect(after.data).toEqual(before.data);
		});

		it("requires If-Match, rejects invalid PUT bodies, and returns 404 for missing resumes", async () => {
			const { resume } = await createResume();

			const missingIfMatch = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
				body: JSON.stringify(syntheticResume("No Precondition")),
			});
			await expectError(missingIfMatch, 400, "BAD_REQUEST");

			const invalidData = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(resume.etag),
				body: JSON.stringify([]),
			});
			await expectError(invalidData, 400, "BAD_REQUEST");

			const malformed = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(resume.etag),
				body: "{ not json",
			});
			await expectError(malformed, 400, "BAD_REQUEST");

			const unsupported = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "PUT",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "text/plain", "If-Match": resume.etag },
				body: JSON.stringify(syntheticResume("Unsupported")),
			});
			await expectError(unsupported, 415, "UNSUPPORTED_MEDIA_TYPE");

			const missing = await fetch(`${baseUrl}/api/resumes/missing`, {
				method: "PUT",
				headers: jsonMutationHeaders(resume.etag),
				body: JSON.stringify(syntheticResume("Missing")),
			});
			await expectError(missing, 404, "NOT_FOUND");
		});
	});

	describe("external file change notifications", () => {
		it("streams a minimal event for an external atomic JSON replacement", async () => {
			const { resume } = await createResume();
			const stream = await openEventStream(resume.id);

			try {
				expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
				expect(stream.response.headers.get("cache-control")).toBe("no-store");

				const external = syntheticResume("Ada External");
				await atomicReplaceResume(resume.id, external);

				const message = await stream.next();
				expect(message.event).toBe("change");

				const payload = JSON.parse(message.data) as Record<string, unknown>;
				const latest = await store.read(resume.id);
				expect(payload).toEqual({ resumeId: resume.id, etag: latest.etag });
				expect(Object.keys(payload).sort()).toEqual(["etag", "resumeId"]);
				expect(message.data).not.toContain("Ada External");
				expect(message.data).not.toContain(dataRoot);
				expect(message.data).not.toContain(resumesDir);
			} finally {
				stream.close();
			}
		});

		it("ignores changes to other resume files", async () => {
			const { resume: watched } = await createResume("Watched Resume");
			const { resume: other } = await createResume("Other Resume");
			const stream = await openEventStream(watched.id);

			try {
				await atomicReplaceResume(other.id, syntheticResume("Other External"));

				// Give an incorrect implementation time to deliver the unrelated event first.
				await new Promise((resolveWait) => setTimeout(resolveWait, 150));
				await atomicReplaceResume(watched.id, syntheticResume("Watched External"));

				const message = await stream.next();
				const payload = JSON.parse(message.data) as { resumeId: string };
				expect(payload.resumeId).toBe(watched.id);
			} finally {
				stream.close();
			}
		});

		it("closes open change streams when the server closes", async () => {
			const { resume } = await createResume();
			const stream = await openEventStream(resume.id);

			try {
				const target = server;
				server = undefined;
				expect(target).toBeDefined();
				await target?.close();
				await expect(stream.next()).rejects.toThrow(/ended/);
			} finally {
				stream.close();
			}
		});

		it("returns a stable error for invalid or missing change streams", async () => {
			await expectError(await fetch(`${baseUrl}/api/resumes/missing/events`), 404, "NOT_FOUND");

			const invalid = await fetch(`${baseUrl}/api/resumes/BAD!/events`, {
				headers: { Origin: ALLOWED_ORIGIN },
			});
			await expectError(invalid, 400, "BAD_REQUEST");

			const wrongMethod = await fetch(`${baseUrl}/api/resumes/ada/events`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN },
			});
			await expectError(wrongMethod, 405, "METHOD_NOT_ALLOWED");
			expect(wrongMethod.headers.get("allow")).toBe("GET");
		});
	});

	describe("duplicate and label", () => {
		it("duplicates a resume into a new saved record", async () => {
			const { resume: source } = await createResume();

			const response = await fetch(`${baseUrl}/api/resumes/${source.id}/duplicate`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ label: "Copy Resume" }),
			});
			expect(response.status).toBe(201);
			const copy = (await response.json()) as StoredResume;

			expect(copy).toMatchObject({ id: "copy-resume", label: "copy-resume", fullName: source.fullName });
			expect(copy.data).toEqual(source.data);
			expect(copy.etag).toMatch(/^[a-f0-9]{64}$/);
			expect(response.headers.get("etag")).toBe(`"${copy.etag}"`);
			expect(response.headers.get("location")).toBe(`/api/resumes/${copy.id}`);
			await expect(store.list()).resolves.toHaveLength(2);
		});

		it("maps duplicate errors for missing sources, invalid labels, and collisions", async () => {
			const { resume: source } = await createResume();

			const missing = await fetch(`${baseUrl}/api/resumes/missing/duplicate`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ label: "Copy" }),
			});
			await expectError(missing, 404, "NOT_FOUND");

			const invalidLabel = await fetch(`${baseUrl}/api/resumes/${source.id}/duplicate`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ label: "" }),
			});
			await expectError(invalidLabel, 400, "BAD_REQUEST");

			await createResume("Copy Resume");
			const collision = await fetch(`${baseUrl}/api/resumes/${source.id}/duplicate`, {
				method: "POST",
				headers: jsonMutationHeaders(),
				body: JSON.stringify({ label: "copy resume" }),
			});
			await expectError(collision, 409, "CONFLICT");
		});

		it("renames with If-Match and rejects stale, missing, and colliding labels", async () => {
			const { resume } = await createResume();

			const response = await fetch(`${baseUrl}/api/resumes/${resume.id}/label`, {
				method: "PATCH",
				headers: jsonMutationHeaders(`"${resume.etag}"`),
				body: JSON.stringify({ label: "Renamed Resume" }),
			});
			expect(response.status).toBe(200);
			const renamed = (await response.json()) as StoredResume;
			expect(renamed).toMatchObject({ id: "renamed-resume", label: "renamed-resume" });
			expect(renamed.etag).toBe(resume.etag);
			expect(response.headers.get("etag")).toBe(`"${renamed.etag}"`);

			const missing = await fetch(`${baseUrl}/api/resumes/${resume.id}/label`, {
				method: "PATCH",
				headers: jsonMutationHeaders(renamed.etag),
				body: JSON.stringify({ label: "Another Name" }),
			});
			await expectError(missing, 404, "NOT_FOUND");

			const other = await createResume("Other Resume");
			const collision = await fetch(`${baseUrl}/api/resumes/${renamed.id}/label`, {
				method: "PATCH",
				headers: jsonMutationHeaders(renamed.etag),
				body: JSON.stringify({ label: other.resume.label }),
			});
			await expectError(collision, 409, "CONFLICT");

			const saved = await fetch(`${baseUrl}/api/resumes/${renamed.id}`, {
				method: "PUT",
				headers: jsonMutationHeaders(renamed.etag),
				body: JSON.stringify(syntheticResume("Changed After Rename")),
			});
			expect(saved.status).toBe(200);

			const stale = await fetch(`${baseUrl}/api/resumes/${renamed.id}/label`, {
				method: "PATCH",
				headers: jsonMutationHeaders(renamed.etag),
				body: JSON.stringify({ label: "Stale Rename" }),
			});
			await expectError(stale, 409, "CONFLICT");

			const missingIfMatch = await fetch(`${baseUrl}/api/resumes/${renamed.id}/label`, {
				method: "PATCH",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
				body: JSON.stringify({ label: "No Precondition" }),
			});
			await expectError(missingIfMatch, 400, "BAD_REQUEST");
		});
	});

	describe("delete", () => {
		it("deletes with If-Match and returns 204", async () => {
			const { resume } = await createResume();

			const response = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "DELETE",
				headers: { Origin: ALLOWED_ORIGIN, "If-Match": `"${resume.etag}"` },
			});

			expect(response.status).toBe(204);
			expect(await response.text()).toBe("");
			await expect(store.list()).resolves.toEqual([]);
		});

		it("requires If-Match and maps stale, missing, and invalid deletes", async () => {
			const { resume } = await createResume();

			const missingIfMatch = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "DELETE",
				headers: { Origin: ALLOWED_ORIGIN },
			});
			await expectError(missingIfMatch, 400, "BAD_REQUEST");

			const stale = await fetch(`${baseUrl}/api/resumes/${resume.id}`, {
				method: "DELETE",
				headers: { Origin: ALLOWED_ORIGIN, "If-Match": "stale-etag" },
			});
			await expectError(stale, 409, "CONFLICT");

			const missing = await fetch(`${baseUrl}/api/resumes/missing`, {
				method: "DELETE",
				headers: { Origin: ALLOWED_ORIGIN, "If-Match": resume.etag },
			});
			await expectError(missing, 404, "NOT_FOUND");

			const invalid = await fetch(`${baseUrl}/api/resumes/BAD!`, {
				method: "DELETE",
				headers: { Origin: ALLOWED_ORIGIN, "If-Match": resume.etag },
			});
			await expectError(invalid, 400, "BAD_REQUEST");
		});
	});

	describe("PDF exports", () => {
		it("archives and returns the same PDF bytes as an attachment", async () => {
			const { resume } = await createResume();
			const pdf = pdfBytes();

			const response = await fetch(`${baseUrl}/api/resumes/${resume.id}/exports`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/pdf" },
				body: pdf,
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/pdf");
			expect(response.headers.get("content-length")).toBe(String(pdf.byteLength));

			const disposition = response.headers.get("content-disposition") ?? "";
			expect(disposition).toContain("attachment");
			expect(disposition).toContain('filename="');
			expect(disposition).not.toContain("..");
			expect(disposition).not.toContain("/");

			const returned = Buffer.from(await response.arrayBuffer());
			expect(returned).toEqual(Buffer.from(pdf));

			const files = await readdir(exportsDir);
			expect(files).toHaveLength(1);
			expect(files[0]).toMatch(/^ada-resume-.+\.pdf$/);
			expect(await readFile(join(exportsDir, files[0]))).toEqual(Buffer.from(pdf));
		});

		it("does not archive a PDF when the resume is missing or the ID is invalid", async () => {
			const missing = await fetch(`${baseUrl}/api/resumes/missing/exports`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/pdf" },
				body: pdfBytes(),
			});
			await expectError(missing, 404, "NOT_FOUND");

			const invalid = await fetch(`${baseUrl}/api/resumes/BAD!/exports`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/pdf" },
				body: pdfBytes(),
			});
			await expectError(invalid, 400, "BAD_REQUEST");

			await expect(readdir(exportsDir)).rejects.toMatchObject({ code: "ENOENT" });
		});

		it("rejects unsupported media types and invalid PDF bytes without archiving", async () => {
			const { resume } = await createResume();

			const unsupported = await fetch(`${baseUrl}/api/resumes/${resume.id}/exports`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
				body: JSON.stringify({ not: "a pdf" }),
			});
			await expectError(unsupported, 415, "UNSUPPORTED_MEDIA_TYPE");

			const invalidPdf = await fetch(`${baseUrl}/api/resumes/${resume.id}/exports`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/pdf" },
				body: "not a pdf",
			});
			await expectError(invalidPdf, 400, "BAD_REQUEST");

			await expect(readdir(exportsDir)).rejects.toMatchObject({ code: "ENOENT" });
		});

		it("enforces the PDF body limit from the declared Content-Length", async () => {
			const { resume } = await createResume();

			const response = await rawRequest({
				method: "POST",
				path: `/api/resumes/${resume.id}/exports`,
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/pdf" },
				declaredLength: PDF_LIMIT + 1,
			});

			expectRawError(response, 413, "PAYLOAD_TOO_LARGE");
			await expect(readdir(exportsDir)).rejects.toMatchObject({ code: "ENOENT" });
		});
	});

	describe("body limits", () => {
		it("rejects an oversized JSON Content-Length before buffering", async () => {
			const response = await rawRequest({
				method: "POST",
				path: "/api/resumes",
				headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
				declaredLength: JSON_LIMIT + 1,
			});

			expectRawError(response, 413, "PAYLOAD_TOO_LARGE");
			await expect(store.list()).resolves.toEqual([]);
		});

		it(
			"stops streaming JSON bodies that exceed 10 MiB",
			async () => {
				const chunks = Array.from({ length: 11 }, () => Buffer.alloc(MIB, 0x20));
				const response = await rawRequest({
					method: "POST",
					path: "/api/resumes",
					headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
					chunks,
				});

				expectRawError(response, 413, "PAYLOAD_TOO_LARGE");
				await expect(store.list()).resolves.toEqual([]);
			},
			20_000,
		);
	});

	describe("routing and failures", () => {
		it("returns stable JSON errors for unknown routes and wrong methods", async () => {
			await expectError(await fetch(`${baseUrl}/api/nope`), 404, "NOT_FOUND");

			const wrongHealth = await fetch(`${baseUrl}/api/health`, {
				method: "POST",
				headers: { Origin: ALLOWED_ORIGIN },
			});
			await expectError(wrongHealth, 405, "METHOD_NOT_ALLOWED");
			expect(wrongHealth.headers.get("allow")).toBe("GET");

			const wrongList = await fetch(`${baseUrl}/api/resumes`, {
				method: "PUT",
				headers: { Origin: ALLOWED_ORIGIN },
			});
			await expectError(wrongList, 405, "METHOD_NOT_ALLOWED");
			expect(wrongList.headers.get("allow")).toBe("GET, POST");

			const wrongDuplicate = await fetch(`${baseUrl}/api/resumes/ada/duplicate`);
			await expectError(wrongDuplicate, 405, "METHOD_NOT_ALLOWED");
			expect(wrongDuplicate.headers.get("allow")).toBe("POST");

			const wrongLabel = await fetch(`${baseUrl}/api/resumes/ada/label`);
			await expectError(wrongLabel, 405, "METHOD_NOT_ALLOWED");
			expect(wrongLabel.headers.get("allow")).toBe("PATCH");

			const wrongExports = await fetch(`${baseUrl}/api/resumes/ada/exports`);
			await expectError(wrongExports, 405, "METHOD_NOT_ALLOWED");
			expect(wrongExports.headers.get("allow")).toBe("POST");
		});

		it("maps unexpected storage failures to 500 without leaking stack traces", async () => {
			const failingStore = {
				list: async () => {
					throw new ResumeStorageError("disk unavailable at /private/secret");
				},
			} as unknown as FileResumeStore;
			const failingServer = createStudioServer(failingStore, pdfStore, {
				allowedOrigin: ALLOWED_ORIGIN,
			});
			const failingBaseUrl = await listen(failingServer);

			try {
				const response = await fetch(`${failingBaseUrl}/api/resumes`);
				const body = await expectError(response, 500, "INTERNAL_ERROR");

				expect(body.error.message).not.toContain("disk unavailable");
				expect(body.error.message).not.toContain("/private/secret");
				expect(JSON.stringify(body)).not.toMatch(/\n\s+at .+:\d+:\d+/);
			} finally {
				await close(failingServer);
			}
		});
	});
});
