// @vitest-environment happy-dom
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { PageMap, PageMapTarget } from "@reactive-resume/pdf/page-map";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResumePdfRender } from "../export/render-resume-pdf";
import { type LoadPdfDocument, type PdfDocumentLike, type PdfPageLike, PdfPreview } from "./pdf-preview";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.summary.content = "<p>Synthetic preview fixture.</p>";
	data.sections.experience.title = "Experience";
	data.sections.experience.items = [
		{
			id: "experience-1",
			hidden: false,
			company: "Analytical Engine Works",
			position: "Programmer",
			location: "",
			period: "",
			dates: { start: null, end: null, present: false },
			website: { url: "", label: "", inlineLink: false },
			description: "",
			roles: [],
		},
	];
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

/** A page whose draw can be completed or failed by the test. */
const deferredPage = () => {
	let resolveRender: () => void = () => undefined;
	let rejectRender: (error: Error) => void = () => undefined;
	const promise = new Promise<void>((resolve, reject) => {
		resolveRender = resolve;
		rejectRender = reject;
	});
	const page: PdfPageLike = {
		getViewport: () => ({ width: 595, height: 842 }),
		render: vi.fn(() => ({ promise, cancel: vi.fn() })),
	};
	return {
		page,
		resolve: () => resolveRender(),
		reject: (error: Error) => rejectRender(error),
	};
};

beforeAll(() => {
	// happy-dom has no canvas backend; the preview only needs a context to pass to pdfjs.
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
	cleanup();
});

describe("PdfPreview", () => {
	it("renders accessible interactive controls for every page-map region and reports their snapshots", async () => {
		const data = syntheticResume();
		const result = rendered();
		const renderPdf = vi.fn(async () => result);
		const loadDocument = vi.fn<LoadPdfDocument>(async () => pdfDocument());
		const onRendered = vi.fn();
		const onRenderSnapshot = vi.fn();

		render(
			<PdfPreview
				data={data}
				renderPdf={renderPdf}
				loadDocument={loadDocument}
				onRendered={onRendered}
				onRenderSnapshot={onRenderSnapshot}
			/>,
		);

		expect(await screen.findByLabelText("PDF page 1")).toBeTruthy();
		await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeTruthy());
		expect(renderPdf).toHaveBeenCalledWith(data);
		expect(loadDocument).toHaveBeenCalledWith(result.blob);
		await waitFor(() => expect(onRendered).toHaveBeenCalledWith(result));
		expect(onRenderSnapshot).toHaveBeenLastCalledWith({ result, data });

		expect(await screen.findByRole("button", { name: "Header: Ada Lovelace" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Experience section" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Experience 1: Analytical Engine Works" })).toBeTruthy();
		expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(3);
	});

	it("reports the selected page target and keeps item controls above their section", async () => {
		const data = syntheticResume();
		const onSelectTarget = vi.fn();

		render(
			<PdfPreview
				data={data}
				renderPdf={async () => rendered()}
				loadDocument={async () => pdfDocument()}
				onSelectTarget={onSelectTarget}
			/>,
		);

		const item = await screen.findByRole("button", { name: "Experience 1: Analytical Engine Works" });
		const section = screen.getByRole("button", { name: "Experience section" });
		expect(Number(item.className.match(/z-(\d+)/)?.[1])).toBeGreaterThan(
			Number(section.className.match(/z-(\d+)/)?.[1]),
		);

		item.focus();
		expect(document.activeElement).toBe(item);
		fireEvent.click(item);
		expect(onSelectTarget).toHaveBeenCalledWith({
			kind: "item",
			sectionId: "experience",
			itemId: "experience-1",
		});
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
		await waitFor(() => expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(3));
		const selected = document.querySelector('[data-page-map-target="item"][data-selected="true"]');
		expect(selected).not.toBeNull();
		expect(selected?.getAttribute("data-item-id")).toBe("experience-1");
	});

	it("keeps a temporary or stale preview layer non-interactive", async () => {
		const data = syntheticResume();
		const onSelectTarget = vi.fn();

		const { rerender } = render(
			<PdfPreview
				data={data}
				renderPdf={async () => rendered()}
				loadDocument={async () => pdfDocument()}
				onSelectTarget={onSelectTarget}
			/>,
		);
		await screen.findByRole("button", { name: "Experience 1: Analytical Engine Works" });

		rerender(
			<PdfPreview
				data={data}
				renderPdf={async () => rendered()}
				loadDocument={async () => pdfDocument()}
				onSelectTarget={onSelectTarget}
				interactive={false}
			/>,
		);
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Experience 1: Analytical Engine Works" })).toBeNull(),
		);
		expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(0);
	});

	it("disables target controls while a newer render has not been promoted", async () => {
		const data = syntheticResume();
		const first = pdfDocument();
		const second = pdfDocument();
		let resolveSecond: (document: PdfDocumentLike) => void = () => undefined;
		const pendingSecond = new Promise<PdfDocumentLike>((resolve) => {
			resolveSecond = resolve;
		});
		const loadDocument = vi
			.fn<LoadPdfDocument>()
			.mockResolvedValueOnce(first)
			.mockImplementationOnce(() => pendingSecond);
		const renderPdf = async () => rendered();

		const { rerender } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} />,
		);
		await screen.findByRole("button", { name: "Experience 1: Analytical Engine Works" });

		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} />);
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));

		// The old active layer is still visible, but it does not match the current draft.
		expect(document.querySelector('[data-pdf-layer="active"]')).not.toBeNull();
		expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(0);

		await act(async () => {
			resolveSecond(second);
			await pendingSecond;
		});
		expect(await screen.findByRole("button", { name: "Header: Grace Hopper" })).toBeTruthy();
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
		await waitFor(() => expect(screen.getByText(/Missing fonts/i)).toBeTruthy());
		expect(screen.getByText(/Missing fonts/i).textContent).toContain("Merriweather");
		expect(screen.getByText(/could not be drawn/i).textContent).toContain("U+20B9");
		expect(screen.getByText(/picture URL/i).textContent).toContain("images.example.test");
		expect(document.querySelectorAll("[data-page-map-target]")).toHaveLength(3);
	});

	it("keeps the last completed document visible until a replacement is fully drawable", async () => {
		const data = syntheticResume();
		const firstResult = rendered({ blob: new Blob(["%PDF-1.7 first"], { type: "application/pdf" }) });
		const secondResult = rendered({ blob: new Blob(["%PDF-1.7 second"], { type: "application/pdf" }) });
		const first = pdfDocument();
		const second = pdfDocument();
		let resolveSecond: (document: PdfDocumentLike) => void = () => undefined;
		const pendingSecond = new Promise<PdfDocumentLike>((resolve) => {
			resolveSecond = resolve;
		});
		const loadDocument = vi
			.fn<LoadPdfDocument>()
			.mockResolvedValueOnce(first)
			.mockImplementationOnce(() => pendingSecond);
		const renderPdf = vi.fn(async () => firstResult).mockResolvedValueOnce(firstResult).mockResolvedValue(secondResult);
		const onRendered = vi.fn();

		const { rerender } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />,
		);
		await screen.findByLabelText("PDF page 1");
		await waitFor(() => expect(onRendered).toHaveBeenLastCalledWith(firstResult));

		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />);
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));

		// The first document is still active and the replacement has not appeared yet.
		expect(first.destroy).not.toHaveBeenCalled();
		expect(document.querySelector('[data-pdf-layer="active"]')).not.toBeNull();
		expect(document.querySelector('[data-pdf-layer="staged"]')).toBeNull();

		await act(async () => {
			resolveSecond(second);
			await pendingSecond;
		});

		await waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(onRendered).toHaveBeenLastCalledWith(secondResult));
		expect(document.querySelector('[data-pdf-layer="active"]')).not.toBeNull();
		expect(document.querySelector('[data-pdf-layer="staged"]')).toBeNull();
		expect(second.destroy).not.toHaveBeenCalled();
	});

	it("keeps the active document until both pages of a two-page replacement draw successfully", async () => {
		const data = syntheticResume();
		const firstResult = rendered({ blob: new Blob(["%PDF-1.7 first"], { type: "application/pdf" }) });
		const secondResult = rendered({ blob: new Blob(["%PDF-1.7 second"], { type: "application/pdf" }) });
		const active = pdfDocument();
		const firstPage = deferredPage();
		const secondPage = deferredPage();
		const replacement = {
			numPages: 2,
			getPage: vi.fn(async (pageNumber: number) =>
				pageNumber === 1 ? firstPage.page : secondPage.page,
			),
			destroy: vi.fn(async () => undefined),
		};
		const loadDocument = vi
			.fn<LoadPdfDocument>()
			.mockResolvedValueOnce(active)
			.mockResolvedValueOnce(replacement);
		const renderPdf = vi
			.fn(async () => firstResult)
			.mockResolvedValueOnce(firstResult)
			.mockResolvedValue(secondResult);
		const onRendered = vi.fn();

		const { rerender } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />,
		);
		await screen.findByLabelText("PDF page 1");
		await waitFor(() => expect(onRendered).toHaveBeenLastCalledWith(firstResult));

		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />);
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(firstPage.page.render).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(secondPage.page.render).toHaveBeenCalledTimes(1));

		// One of two pages drawn: the old document is still the only active layer.
		await act(async () => {
			firstPage.resolve();
			await Promise.resolve();
		});
		expect(document.querySelector('[data-pdf-layer="active"]')).not.toBeNull();
		expect(document.querySelector('[data-pdf-layer="staged"]')).not.toBeNull();
		expect(active.destroy).not.toHaveBeenCalled();
		expect(onRendered).toHaveBeenLastCalledWith(firstResult);

		// Both pages drawn: only now is the replacement promoted.
		await act(async () => {
			secondPage.resolve();
			await Promise.resolve();
		});
		await waitFor(() => expect(active.destroy).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(onRendered).toHaveBeenLastCalledWith(secondResult));
		expect(document.querySelector('[data-pdf-layer="staged"]')).toBeNull();
		expect(replacement.destroy).not.toHaveBeenCalled();
	});

	it("discards a staged replacement when any page draw fails and keeps the active document", async () => {
		const data = syntheticResume();
		const firstResult = rendered({ blob: new Blob(["%PDF-1.7 first"], { type: "application/pdf" }) });
		const active = pdfDocument();
		const failingPage = deferredPage();
		const laterPage = deferredPage();
		const replacement = {
			numPages: 2,
			getPage: vi.fn(async (pageNumber: number) =>
				pageNumber === 1 ? failingPage.page : laterPage.page,
			),
			destroy: vi.fn(async () => undefined),
		};
		const loadDocument = vi
			.fn<LoadPdfDocument>()
			.mockResolvedValueOnce(active)
			.mockResolvedValueOnce(replacement);
		const renderPdf = vi.fn(async () => firstResult);
		const onRendered = vi.fn();

		const { rerender } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />,
		);
		await screen.findByLabelText("PDF page 1");
		await waitFor(() => expect(onRendered).toHaveBeenLastCalledWith(firstResult));

		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />);
		await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(failingPage.page.render).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(laterPage.page.render).toHaveBeenCalledTimes(1));

		await act(async () => {
			failingPage.reject(new Error("replacement page draw failed"));
			await Promise.resolve();
		});

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/could not be drawn/i);
		expect(alert.textContent).toContain("replacement page draw failed");
		expect(document.querySelector('[data-pdf-layer="staged"]')).toBeNull();
		expect(document.querySelector('[data-pdf-layer="active"]')).not.toBeNull();
		expect(replacement.destroy).toHaveBeenCalledTimes(1);
		expect(active.destroy).not.toHaveBeenCalled();
		expect(onRendered).toHaveBeenLastCalledWith(firstResult);

		// A later page settling must not revive the discarded replacement.
		await act(async () => {
			laterPage.resolve();
			await Promise.resolve();
		});
		expect(active.destroy).not.toHaveBeenCalled();
		expect(onRendered).toHaveBeenLastCalledWith(firstResult);
		expect(document.querySelector('[data-pdf-layer="staged"]')).toBeNull();
	});

	it("keeps the last completed document when a replacement render fails", async () => {
		const data = syntheticResume();
		const firstResult = rendered();
		const first = pdfDocument();
		const loadDocument = vi.fn<LoadPdfDocument>(async () => first);
		const renderPdf = vi.fn(async () => firstResult);
		const onRendered = vi.fn();

		const { rerender } = render(
			<PdfPreview data={data} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />,
		);
		await screen.findByLabelText("PDF page 1");
		await waitFor(() => expect(onRendered).toHaveBeenLastCalledWith(firstResult));

		renderPdf.mockRejectedValueOnce(new Error("replacement failed"));
		const next = syntheticResume();
		next.basics.name = "Grace Hopper";
		rerender(<PdfPreview data={next} renderPdf={renderPdf} loadDocument={loadDocument} onRendered={onRendered} />);

		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(first.destroy).not.toHaveBeenCalled();
		expect(document.querySelector('[data-pdf-layer="active"]')).not.toBeNull();
		expect(onRendered).toHaveBeenLastCalledWith(firstResult);
	});

	it("zooms, clamps at the bounds, and resets to fit width", async () => {
		const data = syntheticResume();
		render(
			<PdfPreview data={data} renderPdf={async () => rendered()} loadDocument={async () => pdfDocument()} />,
		);

		await screen.findByLabelText("PDF page 1");
		await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeTruthy());

		const zoomIn = screen.getByRole("button", { name: "Zoom in" });
		const zoomOut = screen.getByRole("button", { name: "Zoom out" });
		const fit = screen.getByRole("button", { name: "Fit to width" });
		const pageWidth = (): string | null | undefined =>
			screen.getByLabelText("PDF page 1").closest("[data-pdf-page-zoom]")?.getAttribute("data-pdf-page-zoom");

		expect(pageWidth()).toBe("100");
		fireEvent.click(zoomIn);
		expect(pageWidth()).toBe("110");
		fireEvent.click(zoomOut);
		expect(pageWidth()).toBe("100");
		fireEvent.click(zoomOut);
		expect(pageWidth()).toBe("90");
		fireEvent.click(fit);
		expect(pageWidth()).toBe("100");

		for (let index = 0; index < 12; index += 1) fireEvent.click(zoomIn);
		expect(pageWidth()).toBe("200");
		expect(zoomIn).toHaveProperty("disabled", true);

		for (let index = 0; index < 20; index += 1) fireEvent.click(zoomOut);
		expect(pageWidth()).toBe("50");
		expect(zoomOut).toHaveProperty("disabled", true);
	});
});
