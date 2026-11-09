// @vitest-environment happy-dom
import type { PdfAtsReport, ResumeSemantics } from "@reactive-resume/resume/ats-pdf";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckPanel } from "./check-panel";
import type { CheckExportedPdfOptions, PdfCheckAnalysis } from "./pdf-check";

const fixedNow = new Date("2026-01-02T00:00:00.000Z");

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const incompleteResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "";
	data.basics.email = "ada@example.test";
	data.basics.phone = "+1 555 0100";
	data.basics.location = "London";
	data.basics.website.url = "not a url";
	data.summary.content = "<p>TypeScript, React and accessible interfaces.</p>";
	data.sections.skills.items = [
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
	];
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
			description: "<p>Wrote an algorithm.</p>",
			roles: [],
		},
	];
	data.sections.certifications.items = [
		{
			id: "cert-1",
			hidden: false,
			title: "Certified Analyst",
			issuer: "Synthetic Institute",
			date: "sometime soon",
			dates: { start: null, end: null, present: false, raw: "sometime soon" },
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Synthetic certification.</p>",
		},
	];
	return data;
};

const pdfReport = (): PdfAtsReport => ({
	version: 1,
	score: 55,
	cappedBy: ["NO_TEXT_LAYER"],
	categories: [],
	checks: [],
	findings: [
		{
			code: "NO_TEXT_LAYER",
			severity: "blocker",
			category: "parseability",
			params: {},
		},
	],
	tips: [],
	counts: { blocker: 1, warning: 0, tip: 0 },
	applicableChecks: 1,
	passedChecks: 0,
	skippedChecks: 3,
	jd: null,
	file: { name: "resume.pdf", sizeBytes: 1234, magicBytesOk: true },
	document: { pageCount: 2, truncated: true, wordCount: 10, operatorsAvailable: false },
});

const emptySemantics = (): ResumeSemantics => ({
	headings: [],
	sectionTypes: [],
	contact: {
		emails: [],
		phones: [],
		textUrls: [],
		annotationUrls: [],
		nameLine: null,
		locationLine: null,
		emailLooksSplit: false,
		linkMismatches: [],
	},
	dates: [],
	quality: {
		tokenCount: 0,
		replacementRatio: 0,
		puaRatio: 0,
		ligatureCount: 0,
		vowellessRatio: 0,
		lexiconHitRatio: 0,
		isEnglish: false,
		runOnTokenRatio: 0,
		singleCharItemRatio: 0,
	},
	bulletLineCount: 0,
	roleLikeLineCount: 0,
	allCapsLineCount: 0,
	quantifiedBulletCount: 0,
	actionVerbBulletCount: 0,
	firstPersonCount: 0,
	longBulletCount: 0,
	unparseableRanges: [],
	ambiguousNumericDates: [],
	employmentGapYears: [],
	repeatedBulletOpenings: [],
	repeatedRunningHeads: [],
});

const pdfAnalysis = (): PdfCheckAnalysis => ({
	report: pdfReport(),
	document: {
		pages: [],
		lines: [],
		fullText: "",
		charCount: 0,
		wordCount: 0,
		modalFontSize: null,
		modalFontRef: null,
		distinctFontRefs: 0,
	},
	semantics: emptySemantics(),
	textReadFailed: false,
});

afterEach(() => {
	cleanup();
});

describe("CheckPanel", () => {
	it("shows the live score, category breakdown, issues, and actionable targets", async () => {
		const user = userEvent.setup();
		const onReviewIssue = vi.fn();
		const onShowOnPdf = vi.fn();
		const selectedIssue = { kind: "item", sectionId: "certifications", itemId: "cert-1" } as const;

		render(
			<CheckPanel
				data={incompleteResume()}
				now={fixedNow}
				onReviewIssue={onReviewIssue}
				onShowOnPdf={onShowOnPdf}
				selectedIssue={selectedIssue}
			/>,
		);

		expect(screen.getByTestId("ats-score").textContent).toBe("87 / 100");
		expect(screen.getByTestId("category-contact").textContent).toContain("5 / 7");
		expect(screen.getByTestId("category-dates").textContent).toContain("4 / 5");

		const issues = within(screen.getByTestId("check-issues")).getAllByRole("listitem");
		expect(issues.map((issue) => issue.getAttribute("data-issue-code"))).toEqual([
			"MISSING_NAME",
			"MALFORMED_URL",
			"UNPARSEABLE_DATE",
		]);
		expect(within(issues[0] as HTMLElement).getByText("Your name is missing")).toBeTruthy();
		expect(within(issues[2] as HTMLElement).getByText("Dates")).toBeTruthy();
		expect(within(issues[2] as HTMLElement).getByText("warning")).toBeTruthy();

		await user.click(
			within(issues[0] as HTMLElement).getByRole("button", {
				name: "Review Your name is missing in Write",
			}),
		);
		expect(onReviewIssue).toHaveBeenCalledWith(
			expect.objectContaining({
				code: "MISSING_NAME",
				editTarget: { fieldId: "write-basics-name", label: "Basics · Full name" },
			}),
		);

		const showButton = within(issues[2] as HTMLElement).getByRole("button", {
			name: "Show A date won't be read on PDF",
		});
		expect(showButton.getAttribute("aria-pressed")).toBe("true");
		await user.click(showButton);
		expect(onShowOnPdf).toHaveBeenCalledWith({
			kind: "item",
			sectionId: "certifications",
			itemId: "cert-1",
		});
	});

	it("shows job-description terms and coverage separately, and no report for an empty posting", async () => {
		const user = userEvent.setup();
		render(
			<CheckPanel
				data={incompleteResume()}
				now={fixedNow}
				onReviewIssue={vi.fn()}
				onShowOnPdf={vi.fn()}
			/>,
		);

		expect(screen.getByText(/Paste a job description/i)).toBeTruthy();

		const posting = screen.getByLabelText("Job description");
		await user.type(posting, "We need React, TypeScript, GraphQL and Kubernetes experience.");

		expect(await screen.findByText("Matched 3 of 4 terms")).toBeTruthy();
		expect(screen.getByText(/71% weighted coverage/)).toBeTruthy();
		expect(screen.getByTestId("matched-terms").textContent).toMatch(/react/i);
		expect(screen.getByTestId("missing-terms").textContent).toMatch(/kubernetes/i);
	});

	it("runs an explicit PDF analysis and reports score, findings, skipped checks, and truncation", async () => {
		const user = userEvent.setup();
		let resolveAnalysis: (analysis: PdfCheckAnalysis) => void = () => undefined;
		const analyzePdf = vi.fn(
			() =>
				new Promise<PdfCheckAnalysis>((resolve) => {
					resolveAnalysis = resolve;
				}),
		);

		render(
			<CheckPanel
				data={incompleteResume()}
				now={fixedNow}
				onReviewIssue={vi.fn()}
				onShowOnPdf={vi.fn()}
				analyzePdf={analyzePdf}
			/>,
		);

		await user.type(screen.getByLabelText("Job description"), "React and TypeScript");
		const button = screen.getByRole("button", { name: "Analyze generated PDF" });
		await user.click(button);

		expect(button).toHaveProperty("disabled", true);
		expect(screen.getByRole("status").textContent).toMatch(/Analyzing the generated PDF locally/i);
		expect(analyzePdf).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({ now: fixedNow, jobDescription: "React and TypeScript" }),
		);

		resolveAnalysis(pdfAnalysis());
		expect(await screen.findByText("PDF score 55 / 100")).toBeTruthy();
		expect(screen.getByTestId("pdf-findings").textContent).toContain("NO_TEXT_LAYER");
		expect(screen.getByText("Skipped checks: 3")).toBeTruthy();
		expect(screen.getByText(/Truncated/)).toBeTruthy();
		expect(button).toHaveProperty("disabled", false);
	});

	it("invalidates a completed PDF report when the resume or posting changes", async () => {
		const user = userEvent.setup();
		const analyzePdf = vi.fn(async () => pdfAnalysis());
		const props = {
			now: fixedNow,
			onReviewIssue: vi.fn(),
			onShowOnPdf: vi.fn(),
			analyzePdf,
		};

		const { rerender } = render(<CheckPanel data={incompleteResume()} {...props} />);
		await user.click(screen.getByRole("button", { name: "Analyze generated PDF" }));
		expect(await screen.findByText("PDF score 55 / 100")).toBeTruthy();

		const edited = incompleteResume();
		edited.summary.content = "<p>React, TypeScript and GraphQL.</p>";
		rerender(<CheckPanel data={edited} {...props} />);
		await waitFor(() => expect(screen.queryByText("PDF score 55 / 100")).toBeNull());
		expect(screen.getByRole("button", { name: "Analyze generated PDF" })).toHaveProperty("disabled", false);

		await user.click(screen.getByRole("button", { name: "Analyze generated PDF" }));
		expect(await screen.findByText("PDF score 55 / 100")).toBeTruthy();
		await user.type(screen.getByLabelText("Job description"), "React");
		await waitFor(() => expect(screen.queryByText("PDF score 55 / 100")).toBeNull());
		expect(screen.getByRole("button", { name: "Analyze generated PDF" })).toHaveProperty("disabled", false);
	});

	it("shares the extracted document with the preview and clears it when the draft changes", async () => {
		const user = userEvent.setup();
		const onAnalysisChange = vi.fn();
		const analyzePdf = vi.fn(async () => pdfAnalysis());
		const data = incompleteResume();

		const { rerender } = render(
			<CheckPanel
				data={data}
				now={fixedNow}
				onReviewIssue={vi.fn()}
				onShowOnPdf={vi.fn()}
				analyzePdf={analyzePdf}
				onAnalysisChange={onAnalysisChange}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Analyze generated PDF" }));
		await screen.findByText("PDF score 55 / 100");
		expect(onAnalysisChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				analysis: expect.objectContaining({
					report: expect.objectContaining({ score: 55 }),
					document: expect.objectContaining({ fullText: "" }),
					semantics: expect.objectContaining({ contact: expect.any(Object) }),
				}),
				data,
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "MISSING_NAME" }),
					expect.objectContaining({ code: "MALFORMED_URL", params: { value: "not a url" } }),
				]),
			}),
		);

		const edited = incompleteResume();
		edited.summary.content = "<p>Changed after the analysis.</p>";
		rerender(
			<CheckPanel
				data={edited}
				now={fixedNow}
				onReviewIssue={vi.fn()}
				onShowOnPdf={vi.fn()}
				analyzePdf={analyzePdf}
				onAnalysisChange={onAnalysisChange}
			/>,
		);

		await waitFor(() => expect(onAnalysisChange).toHaveBeenLastCalledWith(null));
	});

	it("aborts an in-flight PDF analysis and ignores its late report", async () => {
		const user = userEvent.setup();
		let resolveAnalysis: (analysis: PdfCheckAnalysis) => void = () => undefined;
		let signal: { aborted: boolean } | undefined;
		const analyzePdf = vi.fn((_data: ResumeData, options?: CheckExportedPdfOptions) => {
			signal = options?.signal;
			return new Promise<PdfCheckAnalysis>((resolve) => {
				resolveAnalysis = resolve;
			});
		});
		const props = {
			now: fixedNow,
			onReviewIssue: vi.fn(),
			onShowOnPdf: vi.fn(),
			analyzePdf,
		};

		const { rerender } = render(<CheckPanel data={incompleteResume()} {...props} />);
		await user.click(screen.getByRole("button", { name: "Analyze generated PDF" }));
		await waitFor(() => expect(analyzePdf).toHaveBeenCalledTimes(1));
		expect(signal?.aborted).toBe(false);

		const edited = incompleteResume();
		edited.summary.content = "<p>Changed while PDF analysis runs.</p>";
		rerender(<CheckPanel data={edited} {...props} />);
		await waitFor(() => expect(signal?.aborted).toBe(true));

		await act(async () => {
			resolveAnalysis(pdfAnalysis());
		});

		await waitFor(() => expect(screen.queryByText("PDF score 55 / 100")).toBeNull());
		expect(screen.getByRole("button", { name: "Analyze generated PDF" })).toHaveProperty("disabled", false);
		expect(analyzePdf).toHaveBeenCalledTimes(1);
	});

	it("ignores a late PDF analysis error after its inputs change", async () => {
		const user = userEvent.setup();
		let rejectAnalysis: (error: Error) => void = () => undefined;
		let signal: { aborted: boolean } | undefined;
		const analyzePdf = vi.fn((_data: ResumeData, options?: CheckExportedPdfOptions) => {
			signal = options?.signal;
			return new Promise<PdfCheckAnalysis>((_resolve, reject) => {
				rejectAnalysis = reject;
			});
		});
		const props = {
			now: fixedNow,
			onReviewIssue: vi.fn(),
			onShowOnPdf: vi.fn(),
			analyzePdf,
		};

		const { rerender } = render(<CheckPanel data={incompleteResume()} {...props} />);
		await user.click(screen.getByRole("button", { name: "Analyze generated PDF" }));
		await waitFor(() => expect(analyzePdf).toHaveBeenCalledTimes(1));

		const edited = incompleteResume();
		edited.summary.content = "<p>Changed before the error arrives.</p>";
		rerender(<CheckPanel data={edited} {...props} />);
		await waitFor(() => expect(signal?.aborted).toBe(true));

		await act(async () => {
			rejectAnalysis(new Error("stale PDF failure"));
		});

		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(screen.getByRole("button", { name: "Analyze generated PDF" })).toHaveProperty("disabled", false);
	});

	it("reports PDF analysis failures without hiding them", async () => {
		const user = userEvent.setup();
		const analyzePdf = vi.fn(async () => {
			throw new Error("PDF engine unavailable");
		});

		render(
			<CheckPanel
				data={incompleteResume()}
				now={fixedNow}
				onReviewIssue={vi.fn()}
				onShowOnPdf={vi.fn()}
				analyzePdf={analyzePdf}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Analyze generated PDF" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/PDF analysis failed/i);
		expect(alert.textContent).toContain("PDF engine unavailable");
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Analyze generated PDF" })).toHaveProperty("disabled", false),
		);
	});
});
