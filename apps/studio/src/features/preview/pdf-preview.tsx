import type { PageMap, PageMapNode, PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSafeRenderCopy } from "../export/safe-render-copy";
import { renderResumePdf, type ResumePdfRender } from "../export/render-resume-pdf";

export type PdfViewport = { width: number; height: number };

/** The subset of PDF.js's RenderTask the preview relies on. */
export type PdfRenderTaskLike = {
	promise: Promise<void>;
	cancel: () => void;
};

export type PdfPageLike = {
	getViewport: (params: { scale: number }) => PdfViewport;
	render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => PdfRenderTaskLike;
};

export type PdfDocumentLike = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<PdfPageLike>;
	destroy?: () => Promise<void>;
};

export type LoadPdfDocument = (blob: Blob) => Promise<PdfDocumentLike>;

const loadPdfDocument: LoadPdfDocument = async (blob) => {
	const pdfjs = await import("pdfjs-dist");
	const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

	const data = new Uint8Array(await blob.arrayBuffer());
	const document = await pdfjs.getDocument({ data }).promise;
	return document as unknown as PdfDocumentLike;
};

export type PdfPreviewProps = {
	data: ResumeData;
	/** Injectable for deterministic tests; production uses the pinned browser adapter. */
	renderPdf?: (data: ResumeData) => Promise<ResumePdfRender>;
	/** Injectable for deterministic tests; production uses pdfjs-dist. */
	loadDocument?: LoadPdfDocument;
	/** A Check issue target to outline on top of the rendered page map. */
	selectedIssue?: PageMapTarget | null;
	/** Receives the exact render used by the preview, or null when a render fails. */
	onRendered?: (result: ResumePdfRender | null) => void;
};

type PreviewState = {
	status: "idle" | "rendering" | "ready" | "error";
	result?: ResumePdfRender;
	document?: PdfDocumentLike;
	error?: string;
};

const errorMessage = (error: unknown): string =>
	error instanceof Error && error.message.trim() !== "" ? error.message : "The PDF engine returned an unknown error.";

/** PDF.js rejects a cancelled render task; that is expected during effect cleanup, not a page failure. */
const isRenderCancellation = (error: unknown): boolean =>
	error instanceof Error &&
	(error.name === "RenderingCancelledException" || /cancelled|canceled/i.test(error.message));

/** Cleanup must not surface a failure to destroy an already-closed PDF.js document. */
const destroyPdfDocument = (document: PdfDocumentLike | null): void => {
	if (!document?.destroy) return;
	try {
		void document.destroy().catch(() => undefined);
	} catch {
		// A synchronous teardown failure is just as harmless during cleanup.
	}
};

const matchesTarget = (node: PageMapNode, target: PageMapTarget): boolean => {
	if (node.kind !== target.kind) return false;
	if (node.kind === "header" && target.kind === "header") return true;
	if (node.kind === "section" && target.kind === "section") return node.sectionId === target.sectionId;
	if (node.kind === "item" && target.kind === "item") {
		return node.sectionId === target.sectionId && node.itemId === target.itemId;
	}
	return false;
};

function PageMapOverlay({
	node,
	page,
	selected,
}: {
	node: PageMapNode;
	page: { width: number; height: number };
	selected: boolean;
}) {
	const style = {
		left: `${(node.x / page.width) * 100}%`,
		top: `${(node.y / page.height) * 100}%`,
		width: `${(node.width / page.width) * 100}%`,
		height: `${(node.height / page.height) * 100}%`,
	};

	return (
		<div
			aria-hidden="true"
			data-page-map-target={node.kind}
			data-section-id={"sectionId" in node ? node.sectionId : undefined}
			data-item-id={"itemId" in node ? node.itemId : undefined}
			data-selected={selected ? "true" : undefined}
			className={
				selected
					? "pointer-events-none absolute z-10 border-2 border-warn bg-warn/15"
					: "pointer-events-none absolute border border-accent/40 bg-accent/5"
			}
			style={style}
		/>
	);
}

function PdfPage({
	document,
	pageNumber,
	pageMap,
	selectedIssue,
}: {
	document: PdfDocumentLike;
	pageNumber: number;
	pageMap: PageMap;
	selectedIssue: PageMapTarget | null;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [pageError, setPageError] = useState<string | null>(null);
	const pageSize = pageMap.pages[pageNumber - 1];
	// The PDF is the default view; only an explicitly selected Check issue gets a diagnostic overlay.
	const selectedNodes = selectedIssue
		? pageMap.nodes.filter(
				(node) => node.page === pageNumber - 1 && matchesTarget(node, selectedIssue),
			)
		: [];

	useEffect(() => {
		let cancelled = false;
		let renderTask: PdfRenderTaskLike | null = null;
		setPageError(null);

		void (async () => {
			try {
				const page = await document.getPage(pageNumber);
				if (cancelled) return;

				const viewport = page.getViewport({ scale: 2 });
				const canvas = canvasRef.current;
				if (!canvas) return;

				canvas.width = viewport.width;
				canvas.height = viewport.height;
				const context = canvas.getContext("2d");
				// Tests and non-canvas hosts can still inspect the page map without a 2D backend.
				if (!context) return;

				renderTask = page.render({ canvasContext: context, viewport });
				await renderTask.promise;
			} catch (error) {
				// Cleanup cancels the task; PDF.js then rejects it with an expected cancellation error.
				if (!cancelled && !isRenderCancellation(error)) setPageError(errorMessage(error));
			}
		})();

		return () => {
			cancelled = true;
			try {
				renderTask?.cancel();
			} catch {
				// A task that already settled may refuse cancellation; the effect is being torn down anyway.
			}
		};
	}, [document, pageNumber]);

	return (
		<div className="flex flex-col gap-2">
			<div
				role="img"
				aria-label={`PDF page ${pageNumber}`}
				className="relative w-full overflow-hidden bg-white shadow-e1"
			>
				<canvas ref={canvasRef} className="block h-auto w-full" />
				{pageSize
					? selectedNodes.map((node) => (
							<PageMapOverlay
								key={`${node.key}:${node.page}`}
								node={node}
								page={pageSize}
								selected
							/>
						))
					: null}
			</div>
			{pageError ? (
				<p className="text-xs text-danger-text">
					Page {pageNumber} could not be drawn: {pageError}
				</p>
			) : null}
		</div>
	);
}

/**
 * Renders the resume to a PDF Blob once, shows it with pdfjs-dist, and returns the same Blob to the parent
 * for download. A render failure is reported locally; the editor draft is only read, never replaced.
 */
export function PdfPreview({
	data,
	renderPdf = renderResumePdf,
	loadDocument = loadPdfDocument,
	selectedIssue = null,
	onRendered,
}: PdfPreviewProps) {
	const [state, setState] = useState<PreviewState>({ status: "idle" });
	const onRenderedRef = useRef(onRendered);
	const safetyWarnings = useMemo(() => createSafeRenderCopy(data).warnings, [data]);

	useEffect(() => {
		onRenderedRef.current = onRendered;
	}, [onRendered]);

	useEffect(() => {
		let cancelled = false;
		let loadedDocument: PdfDocumentLike | null = null;
		setState({ status: "rendering" });
		onRenderedRef.current?.(null);

		void (async () => {
			try {
				const result = await renderPdf(data);
				if (cancelled) return;
				const document = await loadDocument(result.blob);
				if (cancelled) {
					// A fast edit can cancel this effect while the document is still loading.
					destroyPdfDocument(document);
					return;
				}
				loadedDocument = document;
				setState({ status: "ready", result, document });
				onRenderedRef.current?.(result);
			} catch (error) {
				if (cancelled) return;
				setState({ status: "error", error: errorMessage(error) });
				onRenderedRef.current?.(null);
			}
		})();

		return () => {
			cancelled = true;
			const document = loadedDocument;
			loadedDocument = null;
			destroyPdfDocument(document);
		};
	}, [data, renderPdf, loadDocument]);

	const result = state.result;

	return (
		<div className="flex w-full flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
				<span className="flex items-center gap-2">
					{state.status === "rendering" ? "Rendering PDF…" : null}
					{state.status === "ready" && state.document
						? `Page 1 of ${state.document.numPages}`
						: null}
					{state.status === "idle" ? "Waiting for the resume…" : null}
				</span>
				{result ? (
					<span className="text-ink-3">
						{Math.round(result.blob.size / 1024)} KB · PDF
					</span>
				) : null}
			</div>

			{state.status === "error" ? (
				<div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-text">
					The PDF preview could not render: {state.error} Your editor draft is unchanged and was not saved.
				</div>
			) : null}

			{safetyWarnings.length > 0 ? (
				<ul className="flex flex-col gap-1 rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs text-warn-text">
					{safetyWarnings.map((warning) => (
						<li key={warning}>{warning}</li>
					))}
				</ul>
			) : null}

			{result && result.missingFonts.length > 0 ? (
				<p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs text-warn-text">
					Missing fonts: {result.missingFonts.join(", ")}. The preview used Forme&apos;s built-in fallback.
				</p>
			) : null}

			{result && result.lostCharacters.length > 0 ? (
				<p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs text-warn-text">
					Characters that could not be drawn by any available font: {result.lostCharacters.join(", ")}.
				</p>
			) : null}

			{state.status === "ready" && state.document && result ? (
				<div className="flex flex-col gap-4">
					{Array.from({ length: state.document.numPages }, (_, pageIndex) => pageIndex + 1).map((pageNumber) => (
						<PdfPage
							key={pageNumber}
							document={state.document as PdfDocumentLike}
							pageNumber={pageNumber}
							pageMap={result.pageMap}
							selectedIssue={selectedIssue}
						/>
					))}
				</div>
			) : null}

			{state.status === "rendering" ? (
				<div className="flex min-h-48 items-center justify-center rounded-md border border-line bg-white text-sm text-ink-3">
					Preparing the PDF preview…
				</div>
			) : null}
		</div>
	);
}
