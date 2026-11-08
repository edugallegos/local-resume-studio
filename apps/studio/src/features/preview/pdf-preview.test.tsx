// @vitest-environment happy-dom
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { PageMap, PageMapTarget } from "@reactive-resume/pdf/page-map";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResumePdfRender } from "../export/render-resume-pdf";
import { type LoadPdfDocument, type PdfDocumentLike, type PdfPageLike, PdfPreview } from "./pdf-preview";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.summary.content = "<p>Synthetic preview fixture.</p>";
	return data;
};

const pageMapFor = (): PageMap => ({
	pages: [{ width: 595, height: 842 }],
	nodes: [
		{ kind: "header", key: "page-1/header", page: 0, x: 20, y: 20, width: 220, height: 40 },
		{
			kind: "section",
			sectionId: "experience",
			key: "page-1/section-experience",
			page: 0,
			x: 20,
			y: 100,
			width: 340,
			height: 180,
		},
		{
			kind: "item",
			sectionId: "experience",
			itemId: "experience-1",
			key: "page-1/section-experience/section-items/item-experience-1",
			page: 0,
			x: 24,
			y: 120,
			width: 320,
			height: 70,
		},
	],
});

const rendered = (overrides: Partial<ResumePdfRender> = {}): ResumePdfRender => ({
	blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }),
	pageMap: pageMapFor(),
	missingFonts: [],
	lostCharacters: [],
	...overrides,
});

const pdfDocument = (pages = 1) => ({
	numPages: pages,
	getPage: vi.fn(async () => ({
		getViewport: () => ({ width: 595, height: 842 }),
		render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
	})),
	destroy: vi.fn(async () => undefined),
});

beforeAll(() => {
	// happy-dom has no canvas backend; the preview only needs a context to pass to pdfjs.
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
	cleanup();
});

describe("PdfPreview", () => {
	it("renders the PDF without default page-map diagnostic overlays", async () => {
		const data = syntheticResume();
		const result = rendered();
		const renderPdf = vi.fn(async () => result);
		const loadDocument = vi.fn<LoadPdfDocument>(async () => pdfDocument());
		const onRendered = vi.fn();

		render(
			<PdfPreview
				data={data}
				renderPdf={renderPdf}
				loadDocument={loadDocument}
				onRendered={onRendered}
			/>,
		);

		expect(await screen.findByLabelText("PDF page 1")).toBeTruthy();
		expect(screen.getByText("Page 1 of 1")).toBeTruthy();
		expect(renderPdf).toHaveBeenCalledWith(data);
		expect(loadDocument).toHaveBeenCalledWith(result.blob);
		expect(onRendered).toHaveBeenCalledWith(result);
		expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(0);
	});

	it("highlights only the supplied selected issue target", async () => {
		const data = syntheticResume();
		const selectedIssue: PageMapTarget = { kind: "item", sectionId: "experience", itemId: "experience-1" };

		render(
			<PdfPreview
				data={data}
				renderPdf={async () => rendered()}
				loadDocument={async () => pdfDocument()}
				selectedIssue={selectedIssue}
			/>,
		);

		await screen.findByLabelText("PDF page 1");
		const overlays = document.querySelectorAll("[data-page-map-target]");
		expect(overlays).toHaveLength(1);
		const selected = overlays[0];
		expect(selected?.getAttribute("data-page-map-target")).toBe("item");
		expect(selected?.getAttribute("data-selected")).toBe("true");
		expect(selected?.getAttribute("data-item-id")).toBe("experience-1");
	});

	it("does not start overlapping page renders on one canvas under StrictMode", async () => {
		const data = syntheticResume();
		let resolvePage: (page: PdfPageLike) => void = () => undefined;
		const pendingPage = new Promise<PdfPageLike>((resolve) => {
			resolvePage = resolve;
		});
		const getPage = vi.fn(() => pendingPage);
		const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
		const page: PdfPageLike = {
			getViewport: () => ({ width: 595, height: 842 }),
			render: renderPage,
		};

		render(
			<StrictMode>
				<PdfPreview
					data={data}
					renderPdf={async () => rendered()}
					loadDocument={async () => ({ numPages: 1, getPage })}
				/>
			</StrictMode>,
		);

		// StrictMode mounts the page effect twice while the same getPage promise is pending.
		await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
		await act(async () => {
			resolvePage(page);
			await pendingPage;
		});

		await waitFor(() => expect(renderPage).toHaveBeenCalled());
		expect(renderPage).toHaveBeenCalledTimes(1);
	});

	it("cancels an in-flight page render when the preview unmounts", async () => {
		const data = syntheticResume();
		let rejectRender: (error: Error) => void = () => undefined;
		const pendingRender = new Promise<void>((_resolve, reject) => {
			rejectRender = reject;
		});
		const cancel = vi.fn(() => rejectRender(new Error("RenderingCancelledException")));
		const page: PdfPageLike = {
			getViewport: () => ({ width: 595, height: 842 }),
			render: vi.fn(() => ({ promise: pendingRender, cancel })),
		};

		const { unmount } = render(
			<PdfPreview
				data={data}
				renderPdf={async () => rendered()}
				loadDocument={async () => ({ numPages: 1, getPage: async () => page })}
			/>,
		);

		await screen.findByLabelText("PDF page 1");
		await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));

		unmount();
		expect(cancel).toHaveBeenCalledTimes(1);
		// Let the rejected render task settle through the effect's catch without surfacing a page error.
		await act(async () => {
			await Promise.resolve();
		});
	});

	it("destroys the previous PDF document when a new render replaces it and on unmount", async () => {
		const first = pdfDocument();
		const second = pdfDocument();
		// A rejected destroy must be swallowed by the preview's fire-and-forget cleanup.
		first.destroy.mockRejectedValueOnce(new Error("document already closed"));
		const loadDocument = vi
			.fn<LoadPdfDocument>()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		const renderPdf = async () => rendered();
		const data = syntheticResume();

		const { rerender, unmount } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} />,
		);
		await screen.findByLabelText("PDF page 1");
		expect(first.destroy).not.toHaveBeenCalled();

		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} />);

		await waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));
		await screen.findByLabelText("PDF page 1");
		expect(second.destroy).not.toHaveBeenCalled();

		unmount();
		expect(second.destroy).toHaveBeenCalledTimes(1);
	});

	it("destroys a document that finishes loading after its effect was cancelled", async () => {
		const stale = pdfDocument();
		const replacement = pdfDocument();
		let resolveStale: (document: PdfDocumentLike) => void = () => undefined;
		const pendingStale = new Promise<PdfDocumentLike>((resolve) => {
			resolveStale = resolve;
		});
		const loadDocument = vi
			.fn<LoadPdfDocument>()
			.mockImplementationOnce(() => pendingStale)
			.mockImplementationOnce(async () => replacement);
		const renderPdf = async () => rendered();
		const data = syntheticResume();

		const { rerender } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} />,
		);
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(1));

		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} />);
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));

		await act(async () => {
			resolveStale(stale);
			await pendingStale;
		});

		await waitFor(() => expect(stale.destroy).toHaveBeenCalledTimes(1));
		expect(replacement.destroy).not.toHaveBeenCalled();
	});

	it("reports render errors without changing or losing the editor draft", async () => {
		const data = syntheticResume();
		const before = structuredClone(data);
		const onRendered = vi.fn();

		render(
			<PdfPreview
				data={data}
				renderPdf={async () => {
					throw new Error("WASM unavailable");
				}}
				loadDocument={async () => pdfDocument()}
				onRendered={onRendered}
			/>,
		);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/could not render/i);
		expect(alert.textContent).toMatch(/WASM unavailable/);
		expect(alert.textContent).toMatch(/draft/i);
		expect(onRendered).toHaveBeenCalledWith(null);
		expect(data).toEqual(before);
	});

	it("reports missing fonts, lost characters, and suppressed picture URLs without failing", async () => {
		const data = syntheticResume();
		data.picture.hidden = false;
		data.picture.url = "https://images.example.test/portrait.png";

		render(
			<PdfPreview
				data={data}
				renderPdf={async () =>
					rendered({
						missingFonts: ["Merriweather"],
						lostCharacters: ['"₹" (U+20B9)'],
					})
				}
				loadDocument={async () => pdfDocument()}
			/>,
		);

		await screen.findByLabelText("PDF page 1");
		expect(screen.getByText(/Missing fonts/i).textContent).toContain("Merriweather");
		expect(screen.getByText(/could not be drawn/i).textContent).toContain("U+20B9");
		expect(screen.getByText(/picture URL/i).textContent).toContain("images.example.test");
		expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(0);
	});
});
