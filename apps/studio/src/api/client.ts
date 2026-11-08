import type { ResumeListItem, StoredResume } from "@local-resume/store/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";

/** Error codes returned by the loopback studio API. */
export type ResumeApiErrorCode =
	| "BAD_REQUEST"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "CONFLICT"
	| "UNSUPPORTED_MEDIA_TYPE"
	| "PAYLOAD_TOO_LARGE"
	| "METHOD_NOT_ALLOWED"
	| "INTERNAL_ERROR"
	| "NETWORK_ERROR"
	| "INVALID_RESPONSE";

/** A typed failure from the local resume API. Conflict detection is preserved on the client. */
export class ResumeApiError extends Error {
	readonly status: number;
	readonly code: ResumeApiErrorCode;

	constructor(message: string, status: number, code: ResumeApiErrorCode, options?: ErrorOptions) {
		super(message, options);
		this.name = "ResumeApiError";
		this.status = status;
		this.code = code;
	}
}

export const isResumeConflictError = (error: unknown): error is ResumeApiError =>
	error instanceof ResumeApiError && error.code === "CONFLICT";

/** A minimal same-origin notification. Resume content and file paths never travel through this channel. */
export type ResumeChangeEvent = {
	resumeId: string;
	etag?: string;
};

export type ResumeChangeListener = (event: ResumeChangeEvent) => void;

/** The typed client contract used by the library and editor shell. */
export type ResumeApiClient = {
	list(): Promise<ResumeListItem[]>;
	read(id: string): Promise<StoredResume>;
	create(label: string, data: ResumeData): Promise<StoredResume>;
	save(id: string, data: ResumeData, etag: string): Promise<StoredResume>;
	duplicate(id: string, label: string): Promise<StoredResume>;
	rename(id: string, label: string, etag: string): Promise<StoredResume>;
	remove(id: string, etag: string): Promise<void>;
	/** Archives already-rendered PDF bytes through the loopback API and returns the archive filename. */
	exportPdf(id: string, pdf: Blob): Promise<{ filename: string }>;
	/** Subscribes to same-origin external-change notifications for one open resume and returns the unsubscribe function. */
	watch(id: string, listener: ResumeChangeListener): () => void;
};

export type ResumeApiClientOptions = {
	/** Defaults to the same origin, which is the browser's own `/api` proxy. */
	baseUrl?: string;
	/** Injectable for deterministic tests; defaults to the platform fetch. */
	fetch?: typeof globalThis.fetch;
};

type ResumeListResponse = { resumes: ResumeListItem[] };
type ResumeResponse = { resume: StoredResume };
type ApiErrorResponse = { error: { code?: string; message?: string } };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const trimBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const encodeId = (id: string): string => encodeURIComponent(id);

/** The API stores and compares the raw hash. Strip response quotes but never weaken a validator. */
const rawEtag = (etag: string): string => {
	const value = etag.trim();
	return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
};

const responseEtag = (response: Response): string | null => {
	const header = response.headers.get("etag");
	return header === null ? null : rawEtag(header);
};

const withResponseEtag = (resume: StoredResume, response: Response): StoredResume => ({
	...resume,
	etag: responseEtag(response) ?? resume.etag,
});

/** The archive filename the loopback server attached to an export response. */
const responseFilename = (response: Response, fallback: string): string => {
	const header = response.headers.get("content-disposition");
	const quoted = header?.match(/filename\s*=\s*"([^"]+)"/i);
	const bare = header?.match(/filename\s*=\s*([^;]+)/i);
	const value = quoted?.[1] ?? bare?.[1]?.trim();
	return value && value !== "" ? value : fallback;
};

const toApiError = async (response: Response): Promise<ResumeApiError> => {
	let message = `The local resume API returned HTTP ${response.status}.`;
	let code: ResumeApiErrorCode = "INTERNAL_ERROR";

	try {
		const body = (await response.json()) as unknown;
		if (isRecord(body) && isRecord(body.error)) {
			const error = body.error as ApiErrorResponse["error"];
			if (typeof error.message === "string" && error.message.trim() !== "") message = error.message;
			if (typeof error.code === "string") code = error.code as ResumeApiErrorCode;
		}
	} catch {
		// A proxy or unexpected failure may not return JSON. Keep the stable status message.
	}

	return new ResumeApiError(message, response.status, code);
};

export const createResumeApiClient = (options: ResumeApiClientOptions = {}): ResumeApiClient => {
	const baseUrl = trimBaseUrl(options.baseUrl ?? "");
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const url = (path: string): string => `${baseUrl}${path}`;

	const request = async (path: string, init?: RequestInit): Promise<Response> => {
		try {
			return await fetchImpl(url(path), {
				cache: "no-store",
				...init,
				headers: {
					Accept: "application/json",
					...init?.headers,
				},
			});
		} catch (error) {
			throw new ResumeApiError("The local resume API could not be reached.", 0, "NETWORK_ERROR", {
				cause: error,
			});
		}
	};

	const requestJson = async <T>(path: string, init?: RequestInit): Promise<{ body: T; response: Response }> => {
		const response = await request(path, init);
		if (!response.ok) throw await toApiError(response);

		try {
			return { body: (await response.json()) as T, response };
		} catch (error) {
			throw new ResumeApiError("The local resume API returned an invalid response.", response.status, "INVALID_RESPONSE", {
				cause: error,
			});
		}
	};

	const jsonMutation = (method: "POST" | "PUT" | "PATCH", body: unknown, etag?: string): RequestInit => ({
		method,
		headers: {
			"Content-Type": "application/json",
			...(etag === undefined ? {} : { "If-Match": rawEtag(etag) }),
		},
		body: JSON.stringify(body),
	});

	return {
		async list() {
			const { body } = await requestJson<ResumeListResponse>("/api/resumes");
			return body.resumes;
		},

		async read(id) {
			const { body, response } = await requestJson<ResumeResponse>(`/api/resumes/${encodeId(id)}`);
			return withResponseEtag(body.resume, response);
		},

		async create(label, data) {
			const { body, response } = await requestJson<StoredResume>(
				"/api/resumes",
				jsonMutation("POST", { label, data }),
			);
			return withResponseEtag(body, response);
		},

		async save(id, data, etag) {
			const { body, response } = await requestJson<StoredResume>(
				`/api/resumes/${encodeId(id)}`,
				jsonMutation("PUT", data, etag),
			);
			return withResponseEtag(body, response);
		},

		async duplicate(id, label) {
			const { body, response } = await requestJson<StoredResume>(
				`/api/resumes/${encodeId(id)}/duplicate`,
				jsonMutation("POST", { label }),
			);
			return withResponseEtag(body, response);
		},

		async rename(id, label, etag) {
			const { body, response } = await requestJson<StoredResume>(
				`/api/resumes/${encodeId(id)}/label`,
				jsonMutation("PATCH", { label }, etag),
			);
			return withResponseEtag(body, response);
		},

		async remove(id, etag) {
			const response = await request(`/api/resumes/${encodeId(id)}`, {
				method: "DELETE",
				headers: { "If-Match": rawEtag(etag) },
			});
			if (!response.ok) throw await toApiError(response);
		},

		async exportPdf(id, pdf) {
			const response = await request(`/api/resumes/${encodeId(id)}/exports`, {
				method: "POST",
				headers: { Accept: "application/pdf", "Content-Type": "application/pdf" },
				body: pdf,
			});
			if (!response.ok) throw await toApiError(response);

			const filename = responseFilename(response, `${id}.pdf`);
			// The server echoes the archived bytes; the caller already holds them for download.
			await response.arrayBuffer().catch(() => undefined);
			return { filename };
		},

		watch(id, listener) {
			const EventSourceImpl = globalThis.EventSource;
			if (typeof EventSourceImpl !== "function") return () => undefined;

			let source: EventSource;
			try {
				source = new EventSourceImpl(url(`/api/resumes/${encodeId(id)}/events`));
			} catch {
				return () => undefined;
			}

			const onChange = (event: MessageEvent): void => {
				if (typeof event.data !== "string") return;

				try {
					const body = JSON.parse(event.data) as unknown;
					if (!isRecord(body) || body.resumeId !== id) return;
					listener(
						typeof body.etag === "string" ? { resumeId: id, etag: body.etag } : { resumeId: id },
					);
				} catch {
					// Ignore malformed frames; EventSource will keep the subscription open.
				}
			};

			source.addEventListener("change", onChange);
			return () => {
				source.removeEventListener("change", onChange);
				source.close();
			};
		},
	};
};
