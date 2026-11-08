// @vitest-environment happy-dom
import type { StoredResume } from "@local-resume/store/types";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResumePdfRender } from "../features/export/render-resume-pdf";
import type { LoadPdfDocument, PdfDocumentLike } from "../features/preview/pdf-preview";
import { editResume, type ResumeEdit } from "../features/write/resume-edits";
import { type EditorState, initialEditorState } from "../state/editor-state";
import { EditorShell, type EditorTab } from "./editor-shell";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.summary.content = "<p>Synthetic editor-shell fixture.</p>";
	return data;
};

const pdfDocument = (): PdfDocumentLike => ({
	numPages: 1,
	getPage: async () => ({
		getViewport: () => ({ width: 595, height: 842 }),
		render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
	}),
	destroy: vi.fn(async () => undefined),
});

const renderFor = (data: ResumeData): ResumePdfRender => ({
	blob: new Blob([`%PDF-1.7 ${data.metadata.template}`], { type: "application/pdf" }),
	pageMap: { pages: [{ width: 595, height: 842 }], nodes: [] },
	missingFonts: [],
	lostCharacters: [],
});

beforeAll(() => {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
	cleanup();
});

type HarnessProps = {
	onEdit: (edit: ResumeEdit) => void;
	onPdfRendered: (result: ResumePdfRender | null) => void;
	renderPdf: (data: ResumeData) => Promise<ResumePdfRender>;
	loadPdfDocument: LoadPdfDocument;
	initialData?: ResumeData;
	fitRenderTimeoutMs?: number;
};

function Harness({
	onEdit,
	onPdfRendered,
	renderPdf,
	loadPdfDocument,
	initialData,
	fitRenderTimeoutMs,
}: HarnessProps) {
	const [state, setState] = useState<EditorState>({
		...initialEditorState,
		selectedId: "ada-lovelace",
		data: initialData ?? syntheticResume(),
		etag: "etag-1",
		status: "saved",
	});
	const [activeTab, setActiveTab] = useState<EditorTab>("write");
	const resume: StoredResume = {
		id: "ada-lovelace",
		label: "ada-lovelace",
		fullName: "Ada Lovelace",
		updatedAt: "2026-01-02T03:04:05.000Z",
		etag: "etag-1",
		data: state.data ?? syntheticResume(),
	};

	return (
		<EditorShell
			state={state}
			resume={resume}
			activeTab={activeTab}
			onTabChange={setActiveTab}
			onBack={() => undefined}
			onEdit={(edit) => {
				onEdit(edit);
				setState((current) =>
					current.data
						? { ...current, data: editResume(current.data, edit), dirty: true, status: "idle" }
						: current,
				);
			}}
			onSave={() => undefined}
			renderPdf={renderPdf}
			loadPdfDocument={loadPdfDocument}
			onPdfRendered={onPdfRendered}
			onDownloadPdf={() => undefined}
			pdfReady
			onReviewIssue={() => undefined}
			onShowOnPdf={() => undefined}
			designThumbnailsEnabled={false}
			fitRenderTimeoutMs={fitRenderTimeoutMs}
		/>
	);
}

const setup = () => {
	const onEdit = vi.fn<(edit: ResumeEdit) => void>();
	const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
	const renderPdf = vi.fn(async (data: ResumeData) => renderFor(data));
	const user = userEvent.setup();
	render(
		<Harness
			onEdit={onEdit}
			onPdfRendered={onPdfRendered}
			renderPdf={renderPdf}
			loadPdfDocument={async () => pdfDocument()}
		/>,
	);
	const card = (): HTMLElement => {
		const found = document.querySelector<HTMLElement>('[data-template-id="azurill"]');
		if (!found) throw new Error("Azurill card not found");
		return found;
	};
	return { user, onEdit, onPdfRendered, renderPdf, card };
};

const waitForAppliedRender = async (
	onPdfRendered: ReturnType<typeof vi.fn<(result: ResumePdfRender | null) => void>>,
) => {
	await waitFor(() =>
		expect(onPdfRendered.mock.calls.some(([result]) => (result as ResumePdfRender | null)?.blob)).toBe(
			true,
		),
	);
};

describe("EditorShell temporary template preview", () => {
	it("previews only the visible PDF, without editing the draft or replacing the applied export", async () => {
		const { user, onEdit, onPdfRendered, renderPdf, card } = setup();
		await waitForAppliedRender(onPdfRendered);
		const appliedCalls = onPdfRendered.mock.calls.length;

		await user.click(screen.getByRole("tab", { name: /design/i }));
		fireEvent.pointerEnter(card(), { pointerType: "mouse" });

		expect(await screen.findByText("Previewing Azurill · click to apply")).toBeTruthy();
		await waitFor(() =>
			expect(
				renderPdf.mock.calls.some(([data]) => (data as ResumeData).metadata.template === "azurill"),
			).toBe(true),
		);
		// Let the temporary render load and draw; its completion must still not reach the export callback.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(onEdit).not.toHaveBeenCalled();
		expect(onPdfRendered.mock.calls.length).toBe(appliedCalls);
		expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
		expect(screen.queryByText("Unsaved changes")).toBeNull();
	});

	it("restores the applied template on Escape and applies it only on click", async () => {
		const { user, onEdit, onPdfRendered, renderPdf, card } = setup();
		await waitForAppliedRender(onPdfRendered);
		const appliedCalls = onPdfRendered.mock.calls.length;

		await user.click(screen.getByRole("tab", { name: /design/i }));
		fireEvent.pointerEnter(card(), { pointerType: "mouse" });
		expect(await screen.findByText("Previewing Azurill · click to apply")).toBeTruthy();

		fireEvent.keyDown(card(), { key: "Escape" });
		await waitFor(() => expect(screen.queryByText("Previewing Azurill · click to apply")).toBeNull());
		await waitFor(() => {
			const lastData = renderPdf.mock.calls.at(-1)?.[0] as ResumeData | undefined;
			expect(lastData?.metadata.template).toBe("onyx");
		});
		expect(onEdit).not.toHaveBeenCalled();

		await user.click(card());
		expect(onEdit).toHaveBeenCalledWith({ type: "update-template", template: "azurill" });
		await waitFor(() =>
			expect(card().getAttribute("aria-pressed")).toBe("true"),
		);
		expect(screen.queryByText("Previewing Azurill · click to apply")).toBeNull();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false),
		);

		// Once applied, the newly rendered PDF replaces the export Blob; the hover preview never did.
		await waitFor(() => expect(onPdfRendered.mock.calls.length).toBeGreaterThan(appliedCalls));
	});
});

const pdfWithPages = (pages: number): ResumePdfRender => ({
	blob: new Blob([`%PDF-1.7 ${pages}`], { type: "application/pdf" }),
	pageMap: {
		pages: Array.from({ length: pages }, () => ({ width: 595, height: 842 })),
		nodes: [],
	},
	missingFonts: [],
	lostCharacters: [],
});

describe("EditorShell authored-page overflow and Fit", () => {
	it("reports overflow from completed applied renders and offers Add page while leaving the viewport Fit control intact", async () => {
		const onEdit = vi.fn<(edit: ResumeEdit) => void>();
		const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
		const renderPdf = vi.fn(async (data: ResumeData) => {
			const authored = data.metadata.layout.pages.length;
			return pdfWithPages(authored > 1 ? 1 : 2);
		});
		render(
			<Harness
				onEdit={onEdit}
				onPdfRendered={onPdfRendered}
				renderPdf={renderPdf}
				loadPdfDocument={async () => pdfDocument()}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(await screen.findByText(/runs to 2 pages; 1 authored page/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Fit to width" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Add page" }));
		expect(onEdit).toHaveBeenCalledWith({ type: "add-page" });
		expect(await screen.findByText(/fits within 2 authored pages/i)).toBeTruthy();
	});

	it("tightens density first and stops as soon as a completed render fits", async () => {
		const data = syntheticResume();
		data.metadata.page.gapX = 6;
		data.metadata.page.gapY = 9;
		data.metadata.typography.body.lineHeight = 1.65;
		data.metadata.typography.heading.lineHeight = 1.6;
		data.metadata.page.marginX = 19;
		data.metadata.page.marginY = 16;

		const onEdit = vi.fn<(edit: ResumeEdit) => void>();
		const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
		const renderPdf = vi.fn(async (next: ResumeData) => {
			const fits = next.metadata.page.gapY <= 4 && next.metadata.typography.body.fontSize <= 10;
			return pdfWithPages(fits ? 1 : 2);
		});
		render(
			<Harness
				initialData={data}
				onEdit={onEdit}
				onPdfRendered={onPdfRendered}
				renderPdf={renderPdf}
				loadPdfDocument={async () => pdfDocument()}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(await screen.findByText(/runs to 2 pages/i)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Fit content to 1 authored page" }));
		await waitFor(() => expect(screen.getByText(/fits within 1 authored page/i)).toBeTruthy(), { timeout: 4000 });

		const last = onEdit.mock.calls.at(-1)?.[0];
		expect(last).toEqual({ type: "update-density", density: "compact" });
		const lastRender = renderPdf.mock.calls.at(-1)?.[0] as ResumeData | undefined;
		expect(lastRender?.metadata.page.gapY).toBe(4);
		expect(lastRender?.metadata.page.marginY).toBe(16);
	});

	it("restores fit-related metadata when a render times out after a Fit step", async () => {
		const data = syntheticResume();
		data.metadata.page.gapX = 6;
		data.metadata.page.gapY = 9;
		data.metadata.typography.body.lineHeight = 1.65;
		data.metadata.typography.heading.lineHeight = 1.6;
		data.metadata.page.marginX = 19;
		data.metadata.page.marginY = 16;
		const snapshot = structuredClone(data.metadata);

		const onEdit = vi.fn<(edit: ResumeEdit) => void>();
		const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
		let renders = 0;
		const renderPdf = vi.fn(async () => {
			renders += 1;
			if (renders === 1) return pdfWithPages(2);
			return new Promise<ResumePdfRender>(() => undefined);
		});
		render(
			<Harness
				initialData={data}
				onEdit={onEdit}
				onPdfRendered={onPdfRendered}
				renderPdf={renderPdf}
				loadPdfDocument={async () => pdfDocument()}
				fitRenderTimeoutMs={30}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(await screen.findByText(/runs to 2 pages/i)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Fit content to 1 authored page" }));
		await waitFor(
			() => expect(onEdit.mock.calls.at(-1)?.[0]).toMatchObject({ type: "restore-fit-state" }),
			{ timeout: 3000 },
		);

		const restore = onEdit.mock.calls.at(-1)?.[0] as Extract<ResumeEdit, { type: "restore-fit-state" }>;
		expect(restore.state.page).toEqual({
			gapX: snapshot.page.gapX,
			gapY: snapshot.page.gapY,
			marginX: snapshot.page.marginX,
			marginY: snapshot.page.marginY,
		});
		expect(restore.state.typography.body.fontSize).toBe(snapshot.typography.body.fontSize);
		expect(restore.state.typography.heading.fontSize).toBe(snapshot.typography.heading.fontSize);
		expect(onEdit.mock.calls.some(([edit]) => edit.type === "update-density")).toBe(true);
		expect(await screen.findByText(/took too long and the design was restored/i)).toBeTruthy();
	});

	it("does not restore over an edit that superseded a timed-out Fit", async () => {
		const data = syntheticResume();
		data.metadata.page.gapX = 6;
		data.metadata.page.gapY = 9;
		data.metadata.typography.body.lineHeight = 1.65;
		data.metadata.typography.heading.lineHeight = 1.6;
		data.metadata.page.marginX = 19;
		data.metadata.page.marginY = 16;

		const onEdit = vi.fn<(edit: ResumeEdit) => void>();
		const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
		let renders = 0;
		const renderPdf = vi.fn(async () => {
			renders += 1;
			if (renders === 1) return pdfWithPages(2);
			return new Promise<ResumePdfRender>(() => undefined);
		});
		render(
			<Harness
				initialData={data}
				onEdit={onEdit}
				onPdfRendered={onPdfRendered}
				renderPdf={renderPdf}
				loadPdfDocument={async () => pdfDocument()}
				fitRenderTimeoutMs={500}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(await screen.findByText(/runs to 2 pages/i)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Fit content to 1 authored page" }));
		await waitFor(() => expect(onEdit.mock.calls.some(([edit]) => edit.type === "update-density")).toBe(true));

		fireEvent.change(screen.getByLabelText("Text size"), { target: { value: "12" } });
		await waitFor(() =>
			expect(onEdit.mock.calls.at(-1)?.[0]).toEqual({ type: "update-text-size", bodySize: 12 }),
		);

		expect(await screen.findByText(/a newer edit superseded it/i)).toBeTruthy();
		expect(onEdit.mock.calls.some(([edit]) => edit.type === "restore-fit-state")).toBe(false);
	});

	it("leaves the draft unchanged when no fit step remains", async () => {
		const data = syntheticResume();
		data.metadata.page.gapX = 3;
		data.metadata.page.gapY = 4;
		data.metadata.page.marginX = 10;
		data.metadata.page.marginY = 8;
		data.metadata.typography.body.lineHeight = 1.35;
		data.metadata.typography.heading.lineHeight = 1.35;
		data.metadata.typography.body.fontSize = 9;

		const onEdit = vi.fn<(edit: ResumeEdit) => void>();
		const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
		const renderPdf = vi.fn(async () => pdfWithPages(2));
		render(
			<Harness
				initialData={data}
				onEdit={onEdit}
				onPdfRendered={onPdfRendered}
				renderPdf={renderPdf}
				loadPdfDocument={async () => pdfDocument()}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(await screen.findByText(/runs to 2 pages/i)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Fit content to 1 authored page" }));
		expect(await screen.findByText(/design was unchanged/i)).toBeTruthy();
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("restores the initial fit-related metadata when no step can fit the authored pages", async () => {
		const data = syntheticResume();
		data.metadata.page.gapX = 6;
		data.metadata.page.gapY = 9;
		data.metadata.typography.body.lineHeight = 1.65;
		data.metadata.typography.heading.lineHeight = 1.6;
		data.metadata.page.marginX = 19;
		data.metadata.page.marginY = 16;
		const snapshot = structuredClone(data.metadata);

		const onEdit = vi.fn<(edit: ResumeEdit) => void>();
		const onPdfRendered = vi.fn<(result: ResumePdfRender | null) => void>();
		const renderPdf = vi.fn(async () => pdfWithPages(2));
		render(
			<Harness
				initialData={data}
				onEdit={onEdit}
				onPdfRendered={onPdfRendered}
				renderPdf={renderPdf}
				loadPdfDocument={async () => pdfDocument()}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(await screen.findByText(/runs to 2 pages/i)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Fit content to 1 authored page" }));
		await waitFor(() => expect(onEdit.mock.calls.at(-1)?.[0]).toMatchObject({ type: "restore-fit-state" }), {
			timeout: 8000,
		});

		const restore = onEdit.mock.calls.at(-1)?.[0] as Extract<ResumeEdit, { type: "restore-fit-state" }>;
		expect(restore.state.page).toEqual({
			gapX: snapshot.page.gapX,
			gapY: snapshot.page.gapY,
			marginX: snapshot.page.marginX,
			marginY: snapshot.page.marginY,
		});
		expect(restore.state.typography.body.fontSize).toBe(snapshot.typography.body.fontSize);
		expect(restore.state.typography.heading.fontSize).toBe(snapshot.typography.heading.fontSize);
	});
});
