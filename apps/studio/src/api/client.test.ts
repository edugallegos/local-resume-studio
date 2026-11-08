import type { StoredResume } from "@local-resume/store/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResumeApiClient, isResumeConflictError, ResumeApiError } from "./client";

class FakeEventSource {
	static instances: FakeEventSource[] = [];

	readonly url: string;
	closed = false;
	private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener as (event: MessageEvent<string>) => void);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: EventListener): void {
		this.listeners.get(type)?.delete(listener as (event: MessageEvent<string>) => void);
	}

	close(): void {
		this.closed = true;
	}

	emit(type: string, data: string): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			listener(new MessageEvent(type, { data }));
		}
	}
}

afterEach(() => {
	FakeEventSource.instances = [];
	vi.unstubAllGlobals();
});

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.email = "ada@example.test";
	return data;
};

const storedResume = (): StoredResume => ({
	id: "ada-lovelace",
	label: "ada-lovelace",
	fullName: "Ada Lovelace",
	updatedAt: "2026-01-02T03:04:05.000Z",
	data: syntheticResume(),
	etag: "raw-etag",
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
		...init,
	});

describe("createResumeApiClient", () => {
	it("lists resumes from the same-origin API", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse({ resumes: [{ id: "ada-lovelace", label: "ada-lovelace", fullName: "Ada Lovelace", updatedAt: "x" }] }),
		);
		const client = createResumeApiClient({ fetch: fetchMock });

		await expect(client.list()).resolves.toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/resumes",
			expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ Accept: "application/json" }) }),
		);
	});

	it("normalizes the quoted response ETag to the raw body ETag", async () => {
		const resume = storedResume();
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse({ resume }, { headers: { "Content-Type": "application/json", ETag: `"${resume.etag}"` } }),
		);
		const client = createResumeApiClient({ fetch: fetchMock });

		await expect(client.read(resume.id)).resolves.toMatchObject({ id: resume.id, etag: "raw-etag" });
	});

	it("sends the raw body ETag in If-Match on save and keeps the raw document body", async () => {
		const resume = storedResume();
		const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(resume, { headers: { ETag: '"next-etag"' } }));
		const client = createResumeApiClient({ fetch: fetchMock });

		await expect(client.save(resume.id, resume.data, '"raw-etag"')).resolves.toMatchObject({ etag: "next-etag" });

		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("/api/resumes/ada-lovelace");
		expect(init).toMatchObject({ method: "PUT", headers: expect.objectContaining({ "If-Match": "raw-etag" }) });
		expect(JSON.parse(String(init?.body))).toEqual(resume.data);
	});

	it("does not rewrite a weak validator into a strong one", async () => {
		const resume = storedResume();
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse({ error: { code: "CONFLICT", message: "If-Match requires a strong ETag." } }, { status: 409 }),
		);
		const client = createResumeApiClient({ fetch: fetchMock });

		await expect(client.save(resume.id, resume.data, `W/"${resume.etag}"`)).rejects.toMatchObject({
			code: "CONFLICT",
		});

		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect(init).toMatchObject({ headers: expect.objectContaining({ "If-Match": `W/"${resume.etag}"` }) });
	});

	it("sends If-Match for rename and delete", async () => {
		const resume = storedResume();
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse(resume, { headers: { ETag: '"renamed-etag"' } }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		const client = createResumeApiClient({ fetch: fetchMock });

		await client.rename(resume.id, "Renamed Resume", resume.etag);
		await client.remove(resume.id, "renamed-etag");

		const [renameUrl, renameInit] = fetchMock.mock.calls[0] ?? [];
		expect(renameUrl).toBe("/api/resumes/ada-lovelace/label");
		expect(renameInit).toMatchObject({ method: "PATCH", headers: expect.objectContaining({ "If-Match": "raw-etag" }) });
		expect(JSON.parse(String(renameInit?.body))).toEqual({ label: "Renamed Resume" });

		const [removeUrl, removeInit] = fetchMock.mock.calls[1] ?? [];
		expect(removeUrl).toBe("/api/resumes/ada-lovelace");
		expect(removeInit).toMatchObject({ method: "DELETE", headers: { "If-Match": "renamed-etag" } });
	});

	it("posts the already-rendered PDF Blob to the export route and returns the archive filename", async () => {
		const pdf = new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" });
		const fetchMock = vi.fn<typeof fetch>(async () =>
			new Response(pdf, {
				status: 200,
				headers: {
					"Content-Type": "application/pdf",
					"Content-Disposition": 'attachment; filename="ada-lovelace-2026-01-02.pdf"',
				},
			}),
		);
		const client = createResumeApiClient({ fetch: fetchMock });

		await expect(client.exportPdf("ada lovelace", pdf)).resolves.toEqual({
			filename: "ada-lovelace-2026-01-02.pdf",
		});

		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("/api/resumes/ada%20lovelace/exports");
		expect(init).toMatchObject({
			method: "POST",
			headers: expect.objectContaining({ "Content-Type": "application/pdf", Accept: "application/pdf" }),
		});
		expect(init?.body).toBe(pdf);
	});

	it("maps export failures to the typed API error", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse(
				{ error: { code: "PAYLOAD_TOO_LARGE", message: "Request bodies are limited to 52428800 bytes." } },
				{ status: 413 },
			),
		);
		const client = createResumeApiClient({ fetch: fetchMock });

		await expect(
			client.exportPdf("ada-lovelace", new Blob(["%PDF"], { type: "application/pdf" })),
		).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
	});

	it("throws a typed API error and recognizes conflicts", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse(
				{ error: { code: "CONFLICT", message: "The resume changed on disk since it was read." } },
				{ status: 409 },
			),
		);
		const client = createResumeApiClient({ fetch: fetchMock });

		const error = await client.save("ada-lovelace", syntheticResume(), "stale").catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ResumeApiError);
		expect(error).toMatchObject({
			status: 409,
			code: "CONFLICT",
			message: "The resume changed on disk since it was read.",
		});
		expect(isResumeConflictError(error)).toBe(true);
		expect(isResumeConflictError(new Error("not an API error"))).toBe(false);
	});

	it("subscribes to same-origin resume changes and closes the stream on unsubscribe", () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const client = createResumeApiClient();
		const changes: Array<{ resumeId: string; etag?: string }> = [];

		const unsubscribe = client.watch("ada-lovelace", (change) => changes.push(change));
		const source = FakeEventSource.instances[0];
		expect(source?.url).toBe("/api/resumes/ada-lovelace/events");

		source?.emit("change", JSON.stringify({ resumeId: "ada-lovelace", etag: "etag-2" }));
		source?.emit("change", JSON.stringify({ resumeId: "grace-hopper", etag: "etag-3" }));
		source?.emit("change", "not json");

		expect(changes).toEqual([{ resumeId: "ada-lovelace", etag: "etag-2" }]);

		unsubscribe();
		expect(source?.closed).toBe(true);
	});
});
