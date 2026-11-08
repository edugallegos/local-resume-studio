import type { PageMap, PageMapNode, PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	/** PDF.js pages can release their operator list; the preview calls this during thumbnail-free teardown. */
	cleanup?: () => void;
};

export type PdfDocumentLike = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<PdfPageLike>;
	destroy?: () => Promise<void>;
};

export type LoadPdfDocument = (blob: Blob) => Promise<PdfDocumentLike>;

export const loadPdfDocument: LoadPdfDocument = async (blob) => {
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

type PreviewLayer = {
	id: number;
	status: "active" | "staged";
	result: ResumePdfRender;
	document: PdfDocumentLike;
	renderedPages: number[];
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

const clampZoom = (value: number): number =>
	Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 10) / 10));

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
	layerId,
	onRendered,
	onFailed,
}: {
	document: PdfDocumentLike;
	pageNumber: number;
	pageMap: PageMap;
	selectedIssue: PageMapTarget | null;
	layerId: number;
	onRendered?: (layerId: number, pageNumber: number) => void;
	onFailed?: (layerId: number, pageNumber: number, message: string) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const onRenderedRef = useRef(onRendered);
	const onFailedRef = useRef(onFailed);
	const [pageError, setPageError] = useState<string | null>(null);
	const pageSize = pageMap.pages[pageNumber - 1];
	// The PDF is the default view; only an explicitly selected Check issue gets a diagnostic overlay.
	const selectedNodes = selectedIssue
		? pageMap.nodes.filter(
				(node) => node.page === pageNumber - 1 && matchesTarget(node, selectedIssue),
			)
		: [];

	useEffect(() => {
		onRenderedRef.current = onRendered;
		onFailedRef.current = onFailed;
	}, [onFailed, onRendered]);

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
				if (!canvas) {
					onRenderedRef.current?.(layerId, pageNumber);
					return;
				}

				canvas.width = viewport.width;
				canvas.height = viewport.height;
				const context = canvas.getContext("2d");
				// Tests and non-canvas hosts can still inspect the page map without a 2D backend.
				if (!context) {
					onRenderedRef.current?.(layerId, pageNumber);
					return;
				}

				renderTask = page.render({ canvasContext: context, viewport });
				await renderTask.promise;
				if (!cancelled) onRenderedRef.current?.(layerId, pageNumber);
			} catch (error) {
				// Cleanup cancels the task; PDF.js then rejects it with an expected cancellation error.
				if (!cancelled && !isRenderCancellation(error)) {
					const message = errorMessage(error);
					setPageError(message);
					// A real draw failure must never count as a completed page: the staged replacement is discarded.
					onFailedRef.current?.(layerId, pageNumber, message);
				}
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
	}, [document, layerId, pageNumber]);

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
 * for download. A new render is drawn on a staged layer while the last completed document stays visible;
 * the replacement is promoted only after every page has settled. A render failure is reported locally; the
 * editor draft is only read, never replaced.
 */
export function PdfPreview({
	data,
	renderPdf = renderResumePdf,
	loadDocument = loadPdfDocument,
	selectedIssue = null,
	onRendered,
}: PdfPreviewProps) {
	const [layers, setLayers] = useState<PreviewLayer[]>([]);
	const [rendering, setRendering] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [zoom, setZoom] = useState(1);
	const layersRef = useRef<PreviewLayer[]>([]);
	const nextLayerId = useRef(0);
	const onRenderedRef = useRef(onRendered);
	const safetyWarnings = useMemo(() => createSafeRenderCopy(data).warnings, [data]);

	const commitLayers = useCallback((next: PreviewLayer[]) => {
		layersRef.current = next;
		setLayers(next);
	}, []);

	useEffect(() => {
		onRenderedRef.current = onRendered;
	}, [onRendered]);

	const handlePageFailed = useCallback(
		(layerId: number, pageNumber: number, message: string) => {
			const current = layersRef.current;
			const layer = current.find((candidate) => candidate.id === layerId);
			if (!layer) return;

			setRendering(false);
			setError(`Page ${pageNumber} could not be drawn: ${message}`);

			if (layer.status !== "staged") return;

			// Discard the whole replacement: a partially drawable document must never replace the last good one.
			for (const stale of current) {
				if (stale.status === "staged") destroyPdfDocument(stale.document);
			}
			commitLayers(current.filter((candidate) => candidate.status === "active"));
		},
		[commitLayers],
	);

	const handlePageRendered = useCallback(
		(layerId: number, pageNumber: number) => {
			const current = layersRef.current;
			const layer = current.find((candidate) => candidate.id === layerId);
			if (layer?.status !== "staged" || layer.renderedPages.includes(pageNumber)) return;

			const renderedPages = [...layer.renderedPages, pageNumber];
			if (renderedPages.length < layer.document.numPages) {
				commitLayers(
					current.map((candidate) =>
						candidate.id === layerId ? { ...candidate, renderedPages } : candidate,
					),
				);
				return;
			}

			// Every page of the replacement is drawable: promote it and retire the old document.
			for (const outgoing of current) {
				if (outgoing.id !== layerId) destroyPdfDocument(outgoing.document);
			}
			commitLayers([{ ...layer, renderedPages, status: "active" }]);
			setRendering(false);
			setError(null);
			onRenderedRef.current?.(layer.result);
		},
		[commitLayers],
	);

	useEffect(() => {
		let cancelled = false;
		let loadedDocument: PdfDocumentLike | null = null;

		// A new request supersedes any previous staged replacement immediately; only the latest may appear.
		const existing = layersRef.current;
		const activeOnly = existing.filter((layer) => layer.status === "active");
		if (activeOnly.length !== existing.length) {
			for (const stale of existing) {
				if (stale.status === "staged") destroyPdfDocument(stale.document);
			}
			commitLayers(activeOnly);
		}

		setRendering(true);
		setError(null);
		if (activeOnly.length === 0) onRenderedRef.current?.(null);

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

				const current = layersRef.current;
				// A newer request superseded an earlier staged replacement; it must never flash on screen.
				for (const stale of current) {
					if (stale.status === "staged") destroyPdfDocument(stale.document);
				}
				const layer: PreviewLayer = {
					id: nextLayerId.current++,
					status: "staged",
					result,
					document,
					renderedPages: [],
				};
				commitLayers([...current.filter((candidate) => candidate.status === "active"), layer]);
			} catch (renderError) {
				if (cancelled) return;
				setRendering(false);
				setError(errorMessage(renderError));
				const current = layersRef.current;
				const active = current.filter((layer) => layer.status === "active");
				for (const stale of current) {
					if (stale.status === "staged") destroyPdfDocument(stale.document);
				}
				if (active.length !== current.length) commitLayers(active);
				if (active.length === 0) onRenderedRef.current?.(null);
			}
		})();

		return () => {
			cancelled = true;
			// A document that never became a layer belongs to this cancelled run.
			if (loadedDocument && !layersRef.current.some((layer) => layer.document === loadedDocument)) {
				destroyPdfDocument(loadedDocument);
			}
		};
	}, [commitLayers, data, loadDocument, renderPdf]);

	useEffect(
		() => () => {
			for (const layer of layersRef.current) destroyPdfDocument(layer.document);
			layersRef.current = [];
		},
		[],
	);

	const activeLayer = layers.find((layer) => layer.status === "active") ?? null;
	const result = activeLayer?.result;

	return (
		<div className="flex w-full min-w-0 flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
				<span className="flex items-center gap-2">
					{rendering ? "Rendering PDF…" : null}
					{!rendering && activeLayer ? `Page 1 of ${activeLayer.document.numPages}` : null}
					{!rendering && !activeLayer && !error ? "Waiting for the resume…" : null}
					{rendering && activeLayer ? (
						<span className="text-ink-3">Last completed page stays visible</span>
					) : null}
				</span>
				<div className="flex flex-wrap items-center gap-2">
					{result ? (
						<span className="text-ink-3">{Math.round(result.blob.size / 1024)} KB · PDF</span>
					) : null}
					<div role="toolbar" aria-label="PDF zoom" className="flex items-center gap-1">
						<Button
							variant="secondary"
							size="icon-xs"
							aria-label="Zoom out"
							disabled={zoom <= ZOOM_MIN + 0.001}
							onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
						>
							<Icon name="magnifying-glass-minus" />
						</Button>
						<span aria-live="polite" className="w-10 text-center font-mono text-[11px] text-ink-2">
							{Math.round(zoom * 100)}%
						</span>
						<Button
							variant="secondary"
							size="icon-xs"
							aria-label="Zoom in"
							disabled={zoom >= ZOOM_MAX - 0.001}
							onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
						>
							<Icon name="magnifying-glass-plus" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							aria-label="Fit to width"
							onClick={() => setZoom(1)}
						>
							Fit
						</Button>
					</div>
				</div>
			</div>

			{error ? (
				<div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-text">
					The PDF preview could not render: {error}{" "}
					{activeLayer
						? "The last completed preview stays visible. Your editor draft is unchanged and was not saved."
						: "Your editor draft is unchanged and was not saved."}
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

			{layers.length > 0 ? (
				<div className="flex w-full min-w-0 flex-col gap-4">
					{layers.map((layer) => (
						<div
							key={layer.id}
							data-pdf-layer={layer.status}
							aria-hidden={layer.status !== "active" ? "true" : undefined}
							className={cn(
								"flex flex-col gap-4",
								layer.status !== "active" && "hidden",
							)}
						>
							{Array.from(
								{ length: layer.document.numPages },
								(_, pageIndex) => pageIndex + 1,
							).map((pageNumber) => (
								<div
									key={pageNumber}
									data-pdf-page-zoom={Math.round(zoom * 100)}
									className="mx-auto min-w-0 max-w-none"
									style={{ width: `${Math.round(zoom * 100)}%` }}
								>
									<PdfPage
										document={layer.document}
										pageNumber={pageNumber}
										pageMap={layer.result.pageMap}
										selectedIssue={layer.status === "active" ? selectedIssue : null}
										layerId={layer.id}
										onRendered={handlePageRendered}
										onFailed={handlePageFailed}
									/>
								</div>
							))}
						</div>
					))}
				</div>
			) : null}

			{rendering && !activeLayer ? (
				<div className="flex min-h-48 w-full items-center justify-center rounded-md border border-line bg-white text-sm text-ink-3">
					Preparing the PDF preview…
				</div>
			) : null}
		</div>
	);
}
