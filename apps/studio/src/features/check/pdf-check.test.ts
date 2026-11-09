import { readFile } from "node:fs/promises";
import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderResumePdf } from "../export/render-resume-pdf";
import {
	analyzeExportedPdf,
	checkExportedPdf,
	type CheckPdfDocument,
} from "./pdf-check";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const fixedNow = new Date("2026-01-02T00:00:00.000Z");

const installFetchStub = async () => {
	const font = await readFile("tests/fixtures/TestSerif.woff");
	const realFetch = globalThis.fetch;

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url.startsWith("data:")) return realFetch(input, init);
			if (url.endsWith(".wasm")) {
				const bytes = await readFile(url.replace(/^\//, ""));
				return new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
			}
			if (url.includes("gstatic") || url.includes("jsdelivr")) return new Response(font);
			throw new Error(`Unexpected network request during PDF check: ${url}`);
		}),
	);
};

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const goodResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.basics.phone = "+1 555 0100";
	data.basics.location = "London";
	data.basics.website = { url: "https://ada.example.test", label: "ada.example.test" };
	data.summary.content = "<p>Synthetic summary for exported PDF checks.</p>";
	data.sections.experience.items = [
		{
			id: "exp-1",
			hidden: false,
			company: "Analytical Engine Works",
			position: "Programmer",
			location: "London",
			period: "2019 - 2022",
			dates: { start: "2019", end: "2022", present: false },
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Wrote an algorithm intended for a machine.</p>",
			roles: [],
		},
	];
	return data;
};

const loadWithPdfjs = async (blob: Blob): Promise<CheckPdfDocument> => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const document = await pdfjs.getDocument({
		data: bytes.slice(),
		useWorkerFetch: false,
		isEvalSupported: false,
		disableFontFace: true,
	}).promise;
	return document as unknown as CheckPdfDocument;
};

const fakeAnalysisDocument = () => {
	const page = {
		pageNumber: 1,
		view: [0, 0, 595, 842],
		rotate: 0,
		commonObjs: { has: () => false, get: () => undefined },
		getTextContent: vi.fn(async () => ({
			items: [
				{
					str: "Ada Lovelace",
					transform: [1, 0, 0, 1, 50, 750],
					width: 100,
					height: 12,
					fontName: "f1",
					hasEOL: false,
				},
			],
		})),
		getAnnotations: vi.fn(async () => []),
		getOperatorList: vi.fn(async () => ({ fnArray: [], argsArray: [] })),
		cleanup: vi.fn(),
	};

	const document: CheckPdfDocument & { destroy: ReturnType<typeof vi.fn> } = {
		numPages: 1,
		getMetadata: vi.fn(async () => ({ info: { Producer: "synthetic" } })),
		getMarkInfo: vi.fn(async () => ({ Marked: true })),
		getPage: vi.fn(async () => page),
		destroy: vi.fn(async () => undefined),
	};

	return { document, page };
};

/**
 * Two synthetic pages. Page 1 lists its lower line first in stream order, so the document must
 * reorder it geometrically; page 2 proves the page boundary survives into the extracted text.
 */
const fakeTextDocument = () => {
	const page = (pageNumber: number, items: unknown[]) => ({
		pageNumber,
		view: [0, 0, 595, 842],
		rotate: 0,
		commonObjs: { has: () => false, get: () => undefined },
		getTextContent: vi.fn(async (): Promise<{ items?: unknown[] }> => ({ items })),
		getAnnotations: vi.fn(async () => []),
		getOperatorList: vi.fn(async () => ({ fnArray: [], argsArray: [] })),
		cleanup: vi.fn(),
	});

	const pages = [
		page(1, [
			{
				str: "Second line",
				transform: [1, 0, 0, 1, 50, 700],
				width: 70,
				height: 12,
				fontName: "f1",
				hasEOL: false,
			},
			{
				str: "First line",
				transform: [1, 0, 0, 1, 50, 750],
				width: 70,
				height: 12,
				fontName: "f1",
				hasEOL: false,
			},
		]),
		page(2, [
			{
				str: "Page two text",
				transform: [1, 0, 0, 1, 50, 750],
				width: 90,
				height: 12,
				fontName: "f1",
				hasEOL: false,
			},
		]),
	];

	const document = {
		numPages: 2,
		getMetadata: vi.fn(async () => ({ info: { Producer: "synthetic" } })),
		getMarkInfo: vi.fn(async () => ({ Marked: true })),
		getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
		destroy: vi.fn(async () => undefined),
	};

	return { document, pages };
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("checkExportedPdf", () => {
	it(
		"harvests and analyzes a good locally generated PDF",
		async () => {
			await installFetchStub();
			const data = goodResume();
			const report: PdfAtsReport = await checkExportedPdf(data, {
				renderPdf: (resume) => renderResumePdf(resume),
				loadDocument: loadWithPdfjs,
				now: fixedNow,
			});

			expect(report.file.magicBytesOk).toBe(true);
			expect(report.file.sizeBytes).toBeGreaterThan(1000);
			expect(report.document.pageCount).toBeGreaterThan(0);
			expect(report.document.operatorsAvailable).toBe(true);
			expect(report.score).toBeGreaterThanOrEqual(80);
			expect(report.findings.map((finding) => finding.code)).not.toContain("NO_TEXT_LAYER");
		},
		180_000,
	);

	it(
		"analyzes a bad locally generated two-column PDF and reports its PDF findings",
		async () => {
			await installFetchStub();
			const good = goodResume();
			const bad = goodResume();
			bad.metadata.template = "azurill";
			bad.sections.skills.items = [
				{
					id: "skill-1",
					hidden: false,
					icon: "",
					iconColor: "",
					name: "TypeScript",
					proficiency: "Expert",
					level: 5,
					keywords: ["React", "GraphQL"],
				},
				{
					id: "skill-2",
					hidden: false,
					icon: "",
					iconColor: "",
					name: "Mathematics",
					proficiency: "Expert",
					level: 5,
					keywords: ["Analysis"],
				},
			];
			bad.sections.languages.items = [
				{ id: "lang-1", hidden: false, language: "English", fluency: "Native", level: 5 },
			];

			const goodReport = await checkExportedPdf(good, {
				renderPdf: (resume) => renderResumePdf(resume),
				loadDocument: loadWithPdfjs,
				now: fixedNow,
			});
			const badReport = await checkExportedPdf(bad, {
				renderPdf: (resume) => renderResumePdf(resume),
				loadDocument: loadWithPdfjs,
				now: fixedNow,
			});

			expect(badReport.score).toBeLessThanOrEqual(goodReport.score);
			expect(badReport.findings.length + badReport.tips.length).toBeGreaterThan(0);
			expect(
				badReport.findings.some((finding) => finding.code === "MULTI_COLUMN_LAYOUT") ||
					badReport.cappedBy.includes("MULTI_COLUMN_LAYOUT"),
			).toBe(true);
		},
		180_000,
	);

	it(
		"reports truncation and skipped checks truthfully",
		async () => {
			await installFetchStub();
			const data = goodResume();
			const page = data.metadata.layout.pages[0];
			if (!page) throw new Error("Synthetic fixture is missing its first page.");
			data.metadata.layout.pages = [page, page];

			const report = await checkExportedPdf(data, {
				renderPdf: (resume) => renderResumePdf(resume),
				loadDocument: loadWithPdfjs,
				now: fixedNow,
				maxPages: 1,
				operatorBudgetMs: 0,
			});

			expect(report.document.pageCount).toBe(2);
			expect(report.document.truncated).toBe(true);
			expect(report.document.operatorsAvailable).toBe(false);
			expect(report.skippedChecks).toBeGreaterThan(0);
		},
		180_000,
	);

	it("returns the page-grouped extracted document from the same harvest", async () => {
		const { document } = fakeTextDocument();
		const analysis = await analyzeExportedPdf(goodResume(), {
			renderPdf: async () => ({ blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }) }),
			loadDocument: async () => document as unknown as CheckPdfDocument,
			now: fixedNow,
		});

		expect(analysis.document.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
		expect(analysis.document.pages[0]?.lines.map((line) => line.text)).toEqual(["First line", "Second line"]);
		expect(analysis.document.pages[1]?.lines.map((line) => line.text)).toEqual(["Page two text"]);
		expect(analysis.document.fullText).toBe("First line\nSecond line\n\nPage two text");
		expect(analysis.report.document.pageCount).toBe(2);
		expect(analysis.report.document.truncated).toBe(false);
		expect(analysis.semantics.contact.nameLine).toBe("First line");
		expect(analysis.semantics.headings).toHaveLength(0);
		expect(analysis.textReadFailed).toBe(false);
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});

	it("keeps the extracted document aligned with page truncation", async () => {
		const { document } = fakeTextDocument();
		const analysis = await analyzeExportedPdf(goodResume(), {
			renderPdf: async () => ({ blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }) }),
			loadDocument: async () => document as unknown as CheckPdfDocument,
			now: fixedNow,
			maxPages: 1,
		});

		expect(analysis.report.document.pageCount).toBe(2);
		expect(analysis.report.document.truncated).toBe(true);
		expect(analysis.document.pages).toHaveLength(1);
		expect(analysis.document.pages[0]?.pageNumber).toBe(1);
	});

	it("reports a failed page text read instead of a successful blank page", async () => {
		const { document, pages } = fakeTextDocument();
		const first = pages[0];
		if (!first) throw new Error("Synthetic fixture is missing its first page.");
		vi.mocked(first.getTextContent).mockResolvedValueOnce({});

		const analysis = await analyzeExportedPdf(goodResume(), {
			renderPdf: async () => ({ blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }) }),
			loadDocument: async () => document as unknown as CheckPdfDocument,
			now: fixedNow,
		});

		expect(analysis.textReadFailed).toBe(true);
		expect(analysis.document.pages[0]?.lines).toHaveLength(0);
	});

	it("destroys the PDF document after a successful analysis", async () => {
		const { document } = fakeAnalysisDocument();
		const report = await checkExportedPdf(goodResume(), {
			renderPdf: async () => ({ blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }) }),
			loadDocument: async () => document,
			now: fixedNow,
		});

		expect(report.file.magicBytesOk).toBe(true);
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});

	it("destroys the PDF document when analysis fails", async () => {
		const { document } = fakeAnalysisDocument();
		vi.mocked(document.getPage).mockRejectedValueOnce(new Error("broken page"));

		await expect(
			checkExportedPdf(goodResume(), {
				renderPdf: async () => ({ blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }) }),
				loadDocument: async () => document,
				now: fixedNow,
			}),
		).rejects.toThrow("broken page");
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});

	it("destroys a document loaded after cancellation and rejects with a cancellation error", async () => {
		const { document } = fakeAnalysisDocument();
		const signal = { aborted: false };

		await expect(
			checkExportedPdf(goodResume(), {
				renderPdf: async () => ({ blob: new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }) }),
				loadDocument: async () => {
					signal.aborted = true;
					return document;
				},
				now: fixedNow,
				signal,
			}),
		).rejects.toMatchObject({ name: "PdfCheckCancelledError" });
		expect(document.destroy).toHaveBeenCalledTimes(1);
	});
});
