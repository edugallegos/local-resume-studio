import type {
	ExtractedDocument,
	HarvestProgress,
	PdfAtsReport,
	PdfDocumentLike as HarvestPdfDocumentLike,
	ResumeSemantics,
} from "@reactive-resume/resume/ats-pdf";
import {
	HARVEST_DEFAULTS,
	analyzePdfResume,
	buildExtractedDocument,
	buildResumeSemantics,
	harvestPdfDocument,
} from "@reactive-resume/resume/ats-pdf";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumePdfRender } from "../export/render-resume-pdf";
import { renderResumePdf } from "../export/render-resume-pdf";

export type CheckPdfDocument = HarvestPdfDocumentLike & {
	destroy?: () => Promise<void>;
};

export type PdfCheckSignal = { aborted: boolean };

/**
 * One local harvest produces both the scored report and the geometric document the parser view
 * renders. Keeping them together guarantees the text belongs to the PDF that was just analyzed.
 */
export type PdfCheckAnalysis = {
	report: PdfAtsReport;
	document: ExtractedDocument;
	/** What the pinned parser recognizes in this exact document: contact, headings, dates, links. */
	semantics: ResumeSemantics;
	/** At least one page's text could not be read, so an empty view may be a read failure. */
	textReadFailed: boolean;
};

export type CheckExportedPdfOptions = {
	/** Injected for deterministic tests; production renders the current draft locally. */
	renderPdf?: (data: ResumeData) => Promise<Pick<ResumePdfRender, "blob">>;
	/** Injected for deterministic tests; production loads the bytes with pdfjs-dist. */
	loadDocument?: (blob: Blob) => Promise<CheckPdfDocument>;
	now?: Date;
	/** Included in the PDF report's keyword coverage only; never in the parse score. */
	jobDescription?: string;
	file?: { name: string; sizeBytes: number; magicBytesOk: boolean };
	maxPages?: number;
	operatorBudgetMs?: number;
	operatorBudgetPerPageMs?: number;
	onProgress?: (progress: HarvestProgress) => void;
	signal?: PdfCheckSignal;
};

export class PdfCheckCancelledError extends Error {
	constructor() {
		super("PDF analysis was cancelled.");
		this.name = "PdfCheckCancelledError";
	}
}

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46] as const;

const loadPdfDocument = async (blob: Blob): Promise<CheckPdfDocument> => {
	const pdfjs = await import("pdfjs-dist");
	const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

	const data = new Uint8Array(await blob.arrayBuffer());
	const document = await pdfjs.getDocument({ data }).promise;
	return document as unknown as CheckPdfDocument;
};

const hasPdfHeader = (bytes: Uint8Array): boolean =>
	bytes.length >= PDF_HEADER.length && PDF_HEADER.every((byte, index) => bytes[index] === byte);

const destroyDocument = async (document: CheckPdfDocument | null): Promise<void> => {
	if (!document?.destroy) return;
	try {
		await document.destroy();
	} catch {
		// Cleanup must not replace the report or the real analysis error.
	}
};

/**
 * Renders the current draft, harvests the resulting PDF locally with the vendored ATS reader, and
 * returns both the report and the extractor's page-grouped document. The PDF.js document is
 * released on success, failure, and cancellation.
 */
export const analyzeExportedPdf = async (
	data: ResumeData,
	options: CheckExportedPdfOptions = {},
): Promise<PdfCheckAnalysis> => {
	const now = options.now ?? new Date();
	const signal = options.signal;
	const ensureActive = (): void => {
		if (signal?.aborted) throw new PdfCheckCancelledError();
	};

	ensureActive();
	const rendered = await (options.renderPdf ?? renderResumePdf)(data);
	ensureActive();

	const bytes = new Uint8Array(await rendered.blob.arrayBuffer());
	const file = options.file ?? {
		name: "resume.pdf",
		sizeBytes: bytes.byteLength,
		magicBytesOk: hasPdfHeader(bytes),
	};

	let document: CheckPdfDocument | null = null;
	try {
		document = await (options.loadDocument ?? loadPdfDocument)(rendered.blob);
		ensureActive();

		const jobDescription = options.jobDescription?.trim();
		const raw = await harvestPdfDocument(document, {
			file,
			maxPages: options.maxPages ?? HARVEST_DEFAULTS.maxPages,
			operatorBudgetMs: options.operatorBudgetMs ?? HARVEST_DEFAULTS.operatorBudgetMs,
			operatorBudgetPerPageMs:
				options.operatorBudgetPerPageMs ?? HARVEST_DEFAULTS.operatorBudgetPerPageMs,
			...(options.onProgress ? { onProgress: options.onProgress } : {}),
			...(signal ? { signal } : {}),
		});
		ensureActive();

		const extracted = buildExtractedDocument(raw);
		return {
			report: analyzePdfResume(raw, {
				now,
				...(jobDescription ? { jobDescription } : {}),
			}),
			document: extracted,
			semantics: buildResumeSemantics(raw, extracted, { now }),
			textReadFailed: raw.textReadFailed === true,
		};
	} finally {
		await destroyDocument(document);
	}
};

/**
 * Report-only wrapper kept for existing callers. The analysis path above shares the same harvest.
 */
export const checkExportedPdf = async (
	data: ResumeData,
	options: CheckExportedPdfOptions = {},
): Promise<PdfAtsReport> => (await analyzeExportedPdf(data, options)).report;
