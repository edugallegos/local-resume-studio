import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { describe, expect, it, vi } from "vitest";
import type { ResumePdfRender } from "../export/render-resume-pdf";
import type { PdfDocumentLike, PdfPageLike } from "../preview/pdf-preview";
import {
	createSerialThumbnailQueue,
	hasMeaningfulResumeContent,
	renderTemplateThumbnail,
	TEMPLATE_SAMPLE_IMAGES,
	templateSampleImage,
	thumbnailFingerprint,
} from "./template-thumbnail";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.summary.content = "<p>Synthetic thumbnail fixture.</p>";
	return data;
};

const rendered = (): ResumePdfRender => ({
	blob: new Blob(["%PDF-1.7 thumbnail"], { type: "application/pdf" }),
	pageMap: { pages: [{ width: 595, height: 842 }], nodes: [] },
	missingFonts: [],
	lostCharacters: [],
});

type TestCanvas = HTMLCanvasElement & { toBlob: (callback: (blob: Blob | null) => void, type?: string) => void };

const fakeCanvas = (blob: Blob = new Blob(["png"], { type: "image/png" })): TestCanvas => {
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({}),
		toBlob: (callback: (value: Blob | null) => void) => callback(blob),
	};
	return canvas as unknown as TestCanvas;
};

const fakePage = (overrides: Partial<PdfPageLike> = {}) => {
	const page = {
		getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
		render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
		cleanup: vi.fn(),
		...overrides,
	};
	return page;
};

const fakeDocument = (page = fakePage()): PdfDocumentLike & { destroy: ReturnType<typeof vi.fn> } => ({
	numPages: 1,
	getPage: vi.fn(async () => page),
	destroy: vi.fn(async () => undefined),
});

describe("renderTemplateThumbnail", () => {
	it("renders only page one from a copy with the requested template, then releases PDF resources", async () => {
		const data = syntheticResume();
		const before = structuredClone(data);
		const blob = new Blob(["thumbnail png"], { type: "image/png" });
		const canvas = fakeCanvas(blob);
		const page = fakePage();
		const document = fakeDocument(page);
		const renderPdf = vi.fn(async (_data: ResumeData) => rendered());

		const result = await renderTemplateThumbnail(data, "lapras", {
			renderPdf,
			loadDocument: async () => document,
			createCanvas: () => canvas,
			width: 300,
		});

		expect(result).toBe(blob);
		expect(renderPdf).toHaveBeenCalledTimes(1);
		const previewData = renderPdf.mock.calls[0]?.[0] as ResumeData;
		expect(previewData.metadata.template).toBe("lapras");
		expect(previewData).not.toBe(data);
		expect(data).toEqual(before);

		expect(document.getPage).toHaveBeenCalledWith(1);
		expect(canvas.width).toBe(300);
		expect(page.cleanup).toHaveBeenCalledTimes(1);
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});

	it("destroys a document that finishes loading after the thumbnail was aborted", async () => {
		const data = syntheticResume();
		const document = fakeDocument();
		let resolveDocument: (value: PdfDocumentLike) => void = () => undefined;
		const pending = new Promise<PdfDocumentLike>((resolve) => {
			resolveDocument = resolve;
		});
		let loadingStarted: () => void = () => undefined;
		const loadStarted = new Promise<void>((resolve) => {
			loadingStarted = resolve;
		});
		const controller = new AbortController();

		const result = renderTemplateThumbnail(data, "azurill", {
			renderPdf: async () => rendered(),
			loadDocument: () => {
				loadingStarted();
				return pending;
			},
			createCanvas: () => fakeCanvas(),
			signal: controller.signal,
		});

		await loadStarted;
		controller.abort();
		resolveDocument(document);

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});

	it("cancels an in-flight page draw and cleans up when aborted", async () => {
		const data = syntheticResume();
		let rejectRender: (error: Error) => void = () => undefined;
		const pendingRender = new Promise<void>((_resolve, reject) => {
			rejectRender = reject;
		});
		let started: () => void = () => undefined;
		const startedPromise = new Promise<void>((resolve) => {
			started = resolve;
		});
		let cancel: () => void = () => undefined;
		const page = fakePage({
			render: vi.fn(() => {
				cancel = vi.fn(() => rejectRender(new Error("RenderingCancelledException")));
				started();
				return { promise: pendingRender, cancel };
			}),
		});
		const document = fakeDocument(page);
		const controller = new AbortController();

		const result = renderTemplateThumbnail(data, "kakuna", {
			renderPdf: async () => rendered(),
			loadDocument: async () => document,
			createCanvas: () => fakeCanvas(),
			signal: controller.signal,
		});

		await startedPromise;
		controller.abort();

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});

	it("reports a missing canvas context and still cleans up the document", async () => {
		const data = syntheticResume();
		const document = fakeDocument();
		// The real DOM canvas is available in happy-dom but has no 2D backend; the helper still cleans up.
		const result = renderTemplateThumbnail(data, "porygon", {
			renderPdf: async () => rendered(),
			loadDocument: async () => document,
			createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement,
		});

		await expect(result).rejects.toThrow(/canvas context/i);
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});
});

describe("createSerialThumbnailQueue", () => {
	const wait = async (): Promise<void> => undefined;

	it("runs thumbnail work one task at a time", async () => {
		const enqueue = createSerialThumbnailQueue(wait);
		const order: string[] = [];
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = enqueue(async () => {
			order.push("first-start");
			await firstGate;
			order.push("first-end");
		});
		const second = enqueue(async () => {
			order.push("second");
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(order).toEqual(["first-start"]);

		releaseFirst();
		await first;
		await second;
		expect(order).toEqual(["first-start", "first-end", "second"]);
	});

	it("skips a queued task whose signal aborted before it started", async () => {
		const enqueue = createSerialThumbnailQueue(wait);
		let releaseFirst: () => void = () => undefined;
		let firstStarted: () => void = () => undefined;
		const started = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const first = enqueue(
			() =>
				new Promise<void>((resolve) => {
					releaseFirst = resolve;
					firstStarted();
				}),
		);
		await started;

		const controller = new AbortController();
		const task = vi.fn(async () => "never");
		const queued = enqueue(task, controller.signal);

		controller.abort();
		releaseFirst();
		await first;

		await expect(queued).rejects.toMatchObject({ name: "AbortError" });
		expect(task).not.toHaveBeenCalled();
	});
});

describe("thumbnail content helpers", () => {
	const blankResume = (): ResumeData => {
		const data = structuredClone(defaultResumeData);
		data.basics = {
			...data.basics,
			name: "",
			headline: "",
			email: "",
			phone: "",
			location: "",
			website: { url: "", label: "" },
			customFields: [],
		};
		data.summary.content = "";
		data.picture.hidden = true;
		data.picture.url = "";
		for (const section of Object.values(data.sections)) section.items = [];
		data.customSections = [];
		return data;
	};

	it("skips thumbnails for a resume with no meaningful content", () => {
		expect(hasMeaningfulResumeContent(blankResume())).toBe(false);
		expect(hasMeaningfulResumeContent(syntheticResume())).toBe(true);
	});

	it("ignores the template id in the content fingerprint", () => {
		const data = syntheticResume();
		const other = structuredClone(data);
		other.metadata.template = "lapras";
		expect(thumbnailFingerprint(other)).toBe(thumbnailFingerprint(data));
	});

	it("ships a bundled sample image for every pinned template", () => {
		for (const template of templateSchema.options) {
			expect(TEMPLATE_SAMPLE_IMAGES[template]).toBeTruthy();
			expect(templateSampleImage(template)).toBe(TEMPLATE_SAMPLE_IMAGES[template]);
		}
	});
});
