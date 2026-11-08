import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderResumePdf, type ResumePdfRender } from "../export/render-resume-pdf";
import { loadPdfDocument, type LoadPdfDocument, type PdfDocumentLike, type PdfPageLike } from "../preview/pdf-preview";

import azurillSample from "../../../../../vendor/reactive-resume/templates/jpg/azurill.jpg";
import bronzorSample from "../../../../../vendor/reactive-resume/templates/jpg/bronzor.jpg";
import chikoritaSample from "../../../../../vendor/reactive-resume/templates/jpg/chikorita.jpg";
import ditgarSample from "../../../../../vendor/reactive-resume/templates/jpg/ditgar.jpg";
import dittoSample from "../../../../../vendor/reactive-resume/templates/jpg/ditto.jpg";
import gengarSample from "../../../../../vendor/reactive-resume/templates/jpg/gengar.jpg";
import glalieSample from "../../../../../vendor/reactive-resume/templates/jpg/glalie.jpg";
import kakunaSample from "../../../../../vendor/reactive-resume/templates/jpg/kakuna.jpg";
import laprasSample from "../../../../../vendor/reactive-resume/templates/jpg/lapras.jpg";
import leafishSample from "../../../../../vendor/reactive-resume/templates/jpg/leafish.jpg";
import meowthSample from "../../../../../vendor/reactive-resume/templates/jpg/meowth.jpg";
import onyxSample from "../../../../../vendor/reactive-resume/templates/jpg/onyx.jpg";
import persianSample from "../../../../../vendor/reactive-resume/templates/jpg/persian.jpg";
import pikachuSample from "../../../../../vendor/reactive-resume/templates/jpg/pikachu.jpg";
import porygonSample from "../../../../../vendor/reactive-resume/templates/jpg/porygon.jpg";
import rhyhornSample from "../../../../../vendor/reactive-resume/templates/jpg/rhyhorn.jpg";
import scizorSample from "../../../../../vendor/reactive-resume/templates/jpg/scizor.jpg";
import smeargleSample from "../../../../../vendor/reactive-resume/templates/jpg/smeargle.jpg";

/** The bundled sample image for each pinned template. These ship with the app; no remote image is fetched. */
export const TEMPLATE_SAMPLE_IMAGES: Record<Template, string> = {
	azurill: azurillSample,
	bronzor: bronzorSample,
	chikorita: chikoritaSample,
	ditgar: ditgarSample,
	ditto: dittoSample,
	gengar: gengarSample,
	glalie: glalieSample,
	kakuna: kakunaSample,
	lapras: laprasSample,
	leafish: leafishSample,
	meowth: meowthSample,
	onyx: onyxSample,
	persian: persianSample,
	pikachu: pikachuSample,
	porygon: porygonSample,
	rhyhorn: rhyhornSample,
	scizor: scizorSample,
	smeargle: smeargleSample,
};

export const templateSampleImage = (template: Template): string => TEMPLATE_SAMPLE_IMAGES[template];

/** A stable human label for a template id. */
export const templateDisplayName = (template: Template): string =>
	template.charAt(0).toUpperCase() + template.slice(1);

/** True when the resume has content worth drawing into a gallery thumbnail. */
export const hasMeaningfulResumeContent = (data: ResumeData): boolean => {
	const basics = data.basics;
	const hasBasics =
		[
			basics.name,
			basics.headline,
			basics.email,
			basics.phone,
			basics.location,
			basics.website.url,
		].some((value) => value.trim() !== "") ||
		basics.customFields.some((field) => field.text.trim() !== "" || field.link.trim() !== "");

	if (hasBasics) return true;
	if (data.summary.content.replace(/<[^>]*>/g, " ").trim() !== "") return true;
	if (!data.picture.hidden && data.picture.url.trim() !== "") return true;

	return (
		Object.values(data.sections).some((section) => section.items.length > 0) ||
		data.customSections.some((section) => section.items.length > 0)
	);
};

/** Changes whenever the resume content changes; the template metadata itself does not count. */
export const thumbnailFingerprint = (data: ResumeData): string => {
	const { template: _template, ...metadata } = data.metadata;
	return JSON.stringify({ ...data, metadata });
};

export type TemplateThumbnailDependencies = {
	renderPdf?: typeof renderResumePdf;
	loadDocument?: LoadPdfDocument;
	/** Injectable for deterministic tests; production uses a DOM canvas. */
	createCanvas?: () => HTMLCanvasElement;
	/** Target width in CSS pixels. The first page keeps its aspect ratio. */
	width?: number;
};

export type RenderTemplateThumbnailOptions = TemplateThumbnailDependencies & {
	signal?: AbortSignal;
};

type ThumbnailPageLike = PdfPageLike & { cleanup?: () => void };

const defaultCreateCanvas = (): HTMLCanvasElement => document.createElement("canvas");

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
	new Promise((resolve, reject) => {
		if (typeof canvas.toBlob !== "function") {
			reject(new Error("The browser could not create a thumbnail image."));
			return;
		}
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error("The browser returned an empty thumbnail image."));
		}, "image/png");
	});

const abortError = (): DOMException => new DOMException("Thumbnail generation aborted.", "AbortError");

const throwIfAborted = (signal: AbortSignal | undefined): void => {
	if (signal?.aborted) throw abortError();
};

const destroyDocument = async (document: PdfDocumentLike | null): Promise<void> => {
	if (!document?.destroy) return;
	try {
		await document.destroy();
	} catch {
		// A closed or superseded PDF.js document is safe to ignore during cleanup.
	}
};

/**
 * Renders only the first page of `template` from a render-only copy of `data`. The caller's resume is never
 * mutated, and aborting cancels the in-flight page render and closes the PDF.js document.
 */
export async function renderTemplateThumbnail(
	data: ResumeData,
	template: Template,
	options: RenderTemplateThumbnailOptions = {},
): Promise<Blob> {
	const renderPdf = options.renderPdf ?? renderResumePdf;
	const loadDocument = options.loadDocument ?? loadPdfDocument;
	const createCanvas = options.createCanvas ?? defaultCreateCanvas;
	const width = options.width && options.width > 0 ? options.width : 344;
	const signal = options.signal;

	throwIfAborted(signal);

	const previewData: ResumeData = {
		...data,
		metadata: { ...data.metadata, template },
	};

	const result: ResumePdfRender = await renderPdf(previewData);
	throwIfAborted(signal);

	const document = await loadDocument(result.blob);
	let page: ThumbnailPageLike | null = null;
	let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
	const onAbort = () => {
		try {
			renderTask?.cancel();
		} catch {
			// A task that already settled is harmless to cancel during teardown.
		}
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		throwIfAborted(signal);
		page = (await document.getPage(1)) as ThumbnailPageLike;
		throwIfAborted(signal);

		const base = page.getViewport({ scale: 1 });
		const scale = base.width > 0 ? width / base.width : 1;
		const viewport = page.getViewport({ scale });
		const canvas = createCanvas();
		canvas.width = Math.max(1, Math.ceil(viewport.width));
		canvas.height = Math.max(1, Math.ceil(viewport.height));

		const context = canvas.getContext("2d");
		if (!context) throw new Error("The browser could not create a thumbnail canvas context.");

		renderTask = page.render({ canvasContext: context, viewport });
		try {
			await renderTask.promise;
		} catch (error) {
			if (signal?.aborted) throw abortError();
			throw error;
		}
		throwIfAborted(signal);
		const blob = await canvasToBlob(canvas);
		throwIfAborted(signal);

		return blob;
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			page?.cleanup?.();
		} catch {
			// Page cleanup is best effort; the document teardown below is the real release.
		}
		await destroyDocument(document);
	}
}

/** Resolves when the browser is idle (or promptly where idle callbacks are unavailable). */
export const whenIdle = (): Promise<void> =>
	new Promise((resolve) => {
		if (typeof window !== "undefined" && "requestIdleCallback" in window) {
			window.requestIdleCallback(() => resolve(), { timeout: 2000 });
			return;
		}
		setTimeout(resolve, 0);
	});

/**
 * Runs thumbnail work one task at a time. A queued task whose signal aborted is skipped, so rapid hover or
 * filter changes never leave a stale render competing with the PDF preview.
 */
export function createSerialThumbnailQueue(wait: () => Promise<void> = whenIdle) {
	let tail: Promise<unknown> = Promise.resolve();

	return <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
		const run = tail.then(async () => {
			throwIfAborted(signal);
			await wait();
			throwIfAborted(signal);
			return task();
		});
		// Keep the queue moving even when a task fails or is aborted.
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
}

export const enqueueTemplateThumbnail = createSerialThumbnailQueue();

export type TemplateThumbnailState = {
	url: string | null;
	status: "idle" | "loading" | "ready" | "error";
};

export type UseTemplateThumbnailOptions = {
	data: ResumeData;
	template: Template;
	enabled?: boolean;
	dependencies?: TemplateThumbnailDependencies;
};

/**
 * Generates a first-page image from the user's current draft. Until it is ready the card keeps showing the
 * bundled sample image, and an aborted or failed render simply leaves that fallback in place.
 */
export function useTemplateThumbnail({
	data,
	template,
	enabled = true,
	dependencies,
}: UseTemplateThumbnailOptions): TemplateThumbnailState {
	const [state, setState] = useState<TemplateThumbnailState>({ url: null, status: "idle" });
	const fingerprint = useMemo(() => thumbnailFingerprint(data), [data]);
	const hasContent = useMemo(() => hasMeaningfulResumeContent(data), [data]);
	const dataRef = useRef(data);
	const dependenciesRef = useRef(dependencies);
	dataRef.current = data;
	dependenciesRef.current = dependencies;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the fingerprint is the content key that restarts the render.
	useEffect(() => {
		if (!enabled || !hasContent) {
			setState({ url: null, status: "idle" });
			return;
		}

		const controller = new AbortController();
		let active = true;
		let objectUrl: string | null = null;
		setState({ url: null, status: "loading" });

		void enqueueTemplateThumbnail(async () => {
			const blob = await renderTemplateThumbnail(dataRef.current, template, {
				...dependenciesRef.current,
				signal: controller.signal,
			});
			const url = URL.createObjectURL(blob);
			if (controller.signal.aborted) {
				URL.revokeObjectURL(url);
				return;
			}
			objectUrl = url;
			if (active) setState({ url, status: "ready" });
		}, controller.signal).catch((error: unknown) => {
			if (controller.signal.aborted) return;
			if (error instanceof DOMException && error.name === "AbortError") return;
			if (active) setState({ url: null, status: "error" });
		});

		return () => {
			active = false;
			controller.abort();
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
				objectUrl = null;
			}
		};
		// The fingerprint covers every content field the thumbnail depends on; the template id is separate.
	}, [enabled, hasContent, fingerprint, template]);

	return state;
}
