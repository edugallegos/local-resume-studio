// @vitest-environment happy-dom
import type { RawExtraction, RawTextItem } from "@reactive-resume/resume/ats-pdf";
import {
	analyzePdfResume,
	buildExtractedDocument,
	buildResumeSemantics,
} from "@reactive-resume/resume/ats-pdf";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckIssue } from "./issue-model";
import { ParserPreview } from "./parser-preview";
import type { PdfCheckAnalysis } from "./pdf-check";

const fixedNow = new Date("2026-01-02T00:00:00.000Z");

const item = (str: string, y: number): RawTextItem => ({
	str,
	transform: [1, 0, 0, 1, 50, y],
	width: str.length * 6,
	height: 12,
	fontRef: "f1",
	hasEol: false,
});

/** Synthetic extraction shaped like the pinned reader's output. Never a real resume. */
const rawExtraction = (overrides: Partial<RawExtraction> = {}): RawExtraction => ({
	version: 1,
	file: { name: "resume.pdf", sizeBytes: 1024, magicBytesOk: true },
	pageCount: 2,
	truncated: false,
	textReadFailed: false,
	annotationReadFailed: false,
	pages: [
		{
			pageNumber: 1,
			width: 595,
			height: 842,
			rotation: 0,
			// Deliberately lower line first: the extractor must restore geometric reading order.
			items: [item("Second line", 700), item("First line", 750)],
			operators: null,
		},
		{
			pageNumber: 2,
			width: 595,
			height: 842,
			rotation: 0,
			items: [item("Page two text", 750)],
			operators: null,
		},
	],
	fonts: [],
	links: [],
	metadata: {
		producer: null,
		creator: null,
		title: null,
		author: null,
		language: null,
		pdfVersion: null,
		isEncrypted: false,
		isXfa: false,
		isCollection: false,
		isTagged: false,
		hasAcroForm: false,
	},
	operatorsAvailable: false,
	...overrides,
});

/** One synthetic page with recognizable contact details, headings, and dates. */
const richExtraction = (): RawExtraction =>
	rawExtraction({
		pageCount: 1,
		pages: [
			{
				pageNumber: 1,
				width: 595,
				height: 842,
				rotation: 0,
				items: [
					item("Ada Lovelace", 780),
					item("ada@example.test · +1 555 0100", 760),
					item("London, UK · https://ada.example.test", 740),
					item("EXPERIENCE", 700),
					item("Programmer, Analytical Engine Works · 2019 - 2022", 680),
					item("SELECTED WORK", 660),
					item("EDUCATION", 640),
					item("BSc Mathematics · 2015 - 2019", 620),
				],
				operators: null,
			},
		],
	});

/** Uses the real pinned extraction and semantics paths, not hand-written documents. */
const analysisOf = (raw: RawExtraction): PdfCheckAnalysis => {
	const document = buildExtractedDocument(raw);
	return {
		report: analyzePdfResume(raw, { now: fixedNow }),
		document,
		semantics: buildResumeSemantics(raw, document, { now: fixedNow }),
		textReadFailed: raw.textReadFailed === true,
	};
};

const issue = (code: CheckIssue["code"], params?: CheckIssue["params"]): CheckIssue => ({
	key: `${code}:${JSON.stringify(params ?? {})}`,
	code,
	pointer: "",
	title: code,
	category: "contact",
	categoryLabel: "Contact details",
	severity: "warning",
	editTarget: null,
	pageTarget: null,
	...(params ? { params } : {}),
});

afterEach(() => {
	cleanup();
});

describe("ParserPreview", () => {
	it("shows page headings and the extractor's geometric reading order", () => {
		render(<ParserPreview analysis={analysisOf(rawExtraction())} />);

		expect(screen.getByText(/cannot guarantee how any particular ATS will behave/i)).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Page 1" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Page 2" })).toBeTruthy();

		const pageOne = screen.getByTestId("parser-page-1");
		expect(
			within(pageOne)
				.getAllByText(/line$/i)
				.map((node) => node.textContent),
		).toEqual(["First line", "Second line"]);

		const pageTwo = screen.getByTestId("parser-page-2");
		expect(within(pageTwo).getByText("Page two text")).toBeTruthy();
		expect(screen.queryByTestId("parser-empty")).toBeNull();
		expect(screen.queryByTestId("parser-truncated")).toBeNull();
	});

	it("shows recognized contact, link, heading, and date fields and marks heading lines", () => {
		render(<ParserPreview analysis={analysisOf(richExtraction())} />);

		expect(screen.getByTestId("parser-field-name").textContent).toContain("Ada Lovelace");
		expect(screen.getByTestId("parser-field-email").textContent).toContain("ada@example.test");
		expect(screen.getByTestId("parser-field-phone").textContent).toContain("+1 555 0100");
		expect(screen.getByTestId("parser-field-location").textContent).toContain("London, UK");
		expect(screen.getByTestId("parser-field-links").textContent).toContain("https://ada.example.test");
		expect(screen.getByTestId("parser-field-headings").textContent).toContain("EXPERIENCE");
		expect(screen.getByTestId("parser-field-headings").textContent).toContain("EDUCATION");
		// Detected headings are listed even when the parser cannot map a section type.
		expect(screen.getByTestId("parser-field-headings").textContent).toContain("SELECTED WORK");
		expect(screen.getByTestId("parser-field-dates").textContent).toContain("2019 - 2022");
		expect(screen.getByTestId("parser-field-dates").textContent).toContain("2015 - 2019");

		const pageOne = screen.getByTestId("parser-page-1");
		expect(within(pageOne).getByText("EXPERIENCE").getAttribute("data-recognized-heading")).toBe("true");
		expect(within(pageOne).getByText("EDUCATION").getAttribute("data-recognized-heading")).toBe("true");
		expect(within(pageOne).getByText("SELECTED WORK").getAttribute("data-recognized-heading")).toBe("true");
		expect(within(pageOne).getByText("Ada Lovelace").getAttribute("data-recognized-heading")).toBeNull();
	});

	it("shows Not found and flags fields with matching current issue codes", () => {
		const raw = rawExtraction({
			pageCount: 1,
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					rotation: 0,
					items: [item("12345", 750)],
					operators: null,
				},
			],
		});
		const issues = [
			issue("MISSING_NAME"),
			issue("MISSING_EMAIL"),
			issue("MISSING_PHONE"),
			issue("MISSING_LOCATION"),
			issue("MALFORMED_URL", { value: "not a url" }),
			issue("NON_STANDARD_SECTION_TITLE", { title: "Profile" }),
			issue("UNPARSEABLE_DATE", { value: "sometime soon" }),
		];

		render(<ParserPreview analysis={analysisOf(raw)} issues={issues} />);

		for (const field of ["name", "email", "phone", "location", "links", "headings", "dates"]) {
			const node = screen.getByTestId(`parser-field-${field}`);
			expect(node.textContent).toContain("Not found");
		}

		expect(screen.getByTestId("parser-field-name").getAttribute("data-issue-codes")).toContain("MISSING_NAME");
		expect(screen.getByTestId("parser-field-email").getAttribute("data-issue-codes")).toContain("MISSING_EMAIL");
		expect(screen.getByTestId("parser-field-phone").getAttribute("data-issue-codes")).toContain("MISSING_PHONE");
		expect(screen.getByTestId("parser-field-location").getAttribute("data-issue-codes")).toContain(
			"MISSING_LOCATION",
		);
		expect(screen.getByTestId("parser-field-links").getAttribute("data-issue-codes")).toContain("MALFORMED_URL");
		expect(screen.getByTestId("parser-field-headings").getAttribute("data-issue-codes")).toContain(
			"NON_STANDARD_SECTION_TITLE",
		);
		expect(screen.getByTestId("parser-field-dates").getAttribute("data-issue-codes")).toContain(
			"UNPARSEABLE_DATE",
		);
	});

	it("highlights the exact extracted lines named by structured issue params", () => {
		const issues = [
			issue("MALFORMED_EMAIL", { value: "ada@example.test" }),
			issue("UNPARSEABLE_DATE", { value: "2019 - 2022" }),
		];

		render(<ParserPreview analysis={analysisOf(richExtraction())} issues={issues} />);

		const pageOne = screen.getByTestId("parser-page-1");
		const emailLine = within(pageOne).getByText(/ada@example\.test/);
		expect(emailLine.getAttribute("data-highlighted")).toBe("true");
		expect(emailLine.getAttribute("data-issue-codes")).toContain("MALFORMED_EMAIL");

		const dateLine = within(pageOne).getByText(/2019 - 2022/);
		expect(dateLine.getAttribute("data-highlighted")).toBe("true");
		expect(dateLine.getAttribute("data-issue-codes")).toContain("UNPARSEABLE_DATE");

		expect(within(pageOne).getByText("Ada Lovelace").getAttribute("data-highlighted")).toBeNull();
		expect(within(pageOne).getByText("EXPERIENCE").getAttribute("data-highlighted")).toBeNull();
	});

	it("does not highlight lines from one- or two-character issue values", () => {
		const raw = rawExtraction({
			pageCount: 1,
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					rotation: 0,
					items: [item("a ab 12 a b abc", 750)],
					operators: null,
				},
			],
		});
		const issues = [
			issue("MALFORMED_EMAIL", { value: "a" }),
			issue("MALFORMED_URL", { value: "ab" }),
			issue("UNPARSEABLE_DATE", { value: 12 }),
			issue("UNPARSEABLE_PERIOD", { value: "a b" }),
			issue("FUTURE_DATED_PERIOD", { value: "abc" }),
		];

		render(<ParserPreview analysis={analysisOf(raw)} issues={issues} />);

		const line = within(screen.getByTestId("parser-page-1")).getByText("a ab 12 a b abc");
		expect(line.getAttribute("data-highlighted")).toBe("true");
		expect(line.getAttribute("data-issue-codes")).toBe("FUTURE_DATED_PERIOD");
	});

	it("flags the section-headings field for layout and fragmentation issues", () => {
		const issues = [
			issue("SECTION_MISSING_FROM_LAYOUT"),
			issue("NO_VISIBLE_EXPERIENCE"),
			issue("FRAGMENTED_ENTRY"),
		];

		render(<ParserPreview analysis={analysisOf(richExtraction())} issues={issues} />);

		const codes = screen.getByTestId("parser-field-headings").getAttribute("data-issue-codes");
		expect(codes).toContain("SECTION_MISSING_FROM_LAYOUT");
		expect(codes).toContain("NO_VISIBLE_EXPERIENCE");
		expect(codes).toContain("FRAGMENTED_ENTRY");
	});

	it("reports empty extraction as an empty result, not a blank resume", () => {
		const raw = rawExtraction({
			pageCount: 1,
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					rotation: 0,
					items: [],
					operators: null,
				},
			],
		});
		render(<ParserPreview analysis={analysisOf(raw)} />);

		const empty = screen.getByTestId("parser-empty");
		expect(empty.textContent).toMatch(/No text was recovered/i);
		expect(empty.textContent).toMatch(/may see an empty resume even though the pages look fine/i);
	});

	it("reports failed page reads separately from genuinely empty text", () => {
		const raw = rawExtraction({
			textReadFailed: true,
			pageCount: 1,
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					rotation: 0,
					items: [],
					operators: null,
				},
			],
		});
		render(<ParserPreview analysis={analysisOf(raw)} />);

		expect(screen.getByTestId("parser-read-failed").textContent).toMatch(/could not be read/i);
		expect(screen.getByTestId("parser-empty").textContent).toMatch(/may not mean the resume has no text/i);
	});

	it("warns that only the first pages were analyzed when truncated", () => {
		const raw = rawExtraction({
			pageCount: 3,
			truncated: true,
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					rotation: 0,
					items: [item("Only page", 750)],
					operators: null,
				},
			],
		});
		render(<ParserPreview analysis={analysisOf(raw)} />);

		expect(screen.getByTestId("parser-truncated").textContent).toMatch(/Only the first 1 of 3 pages/i);
		expect(screen.getByTestId("parser-page-1")).toBeTruthy();
		expect(screen.queryByTestId("parser-page-2")).toBeNull();
	});

	it("marks a harvested page with no lines without dropping its page heading", () => {
		const raw = rawExtraction({
			pageCount: 2,
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					rotation: 0,
					items: [item("First page text", 750)],
					operators: null,
				},
				{
					pageNumber: 2,
					width: 595,
					height: 842,
					rotation: 0,
					items: [],
					operators: null,
				},
			],
		});
		render(<ParserPreview analysis={analysisOf(raw)} />);

		expect(screen.getByRole("heading", { name: "Page 2" })).toBeTruthy();
		expect(within(screen.getByTestId("parser-page-2")).getByText("No text on this page.")).toBeTruthy();
	});
});
