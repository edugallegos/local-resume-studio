import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { ATS_CATEGORY_LABELS, type CheckIssue } from "./issue-model";
import { getCheckResult } from "./check-model";
import { matchPastedJob } from "./job-match";
import {
	checkExportedPdf,
	PdfCheckCancelledError,
	type CheckExportedPdfOptions,
	type PdfCheckSignal,
} from "./pdf-check";

export type CheckPanelProps = {
	data: ResumeData;
	now?: Date;
	onReviewIssue: (issue: CheckIssue) => void;
	onShowOnPdf: (target: PageMapTarget) => void;
	selectedIssue?: PageMapTarget | null;
	renderPdf?: CheckExportedPdfOptions["renderPdf"];
	/** The preview loader is reused for analysis; it returns the same PDF.js proxy shape in production. */
	loadPdfDocument?: (blob: Blob) => Promise<unknown>;
	/** Injected for deterministic tests; production performs the local PDF analysis. */
	analyzePdf?: typeof checkExportedPdf;
};

type PdfAnalysisState =
	| { status: "idle" }
	| { status: "analyzing" }
	| { status: "done"; report: PdfAtsReport }
	| { status: "error"; error: string };

const errorMessage = (error: unknown): string =>
	error instanceof Error && error.message.trim() !== "" ? error.message : "The local PDF analysis failed.";

const targetsEqual = (a: PageMapTarget | null | undefined, b: PageMapTarget | null | undefined): boolean => {
	if (!a || !b || a.kind !== b.kind) return false;
	if (a.kind === "header" && b.kind === "header") return true;
	if (a.kind === "section" && b.kind === "section") return a.sectionId === b.sectionId;
	if (a.kind === "item" && b.kind === "item") {
		return a.sectionId === b.sectionId && a.itemId === b.itemId;
	}
	return false;
};

const severityVariant = (severity: CheckIssue["severity"]) =>
	severity === "error" ? "danger" : severity === "warning" ? "warn" : "info";

const pdfFindingLabel = (code: string): string => code.replaceAll("_", " ").toLowerCase();

export function CheckPanel({
	data,
	now,
	onReviewIssue,
	onShowOnPdf,
	selectedIssue = null,
	renderPdf,
	loadPdfDocument,
	analyzePdf = checkExportedPdf,
}: CheckPanelProps) {
	const { report, issues } = useMemo(() => getCheckResult(data, now), [data, now]);
	const [posting, setPosting] = useState("");
	const jobMatch = useMemo(() => matchPastedJob(data, posting), [data, posting]);
	const [pdfState, setPdfState] = useState<PdfAnalysisState>({ status: "idle" });
	const activeSignal = useRef<PdfCheckSignal | null>(null);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (activeSignal.current) activeSignal.current.aborted = true;
		};
	}, []);

	// A PDF report belongs to the exact draft and posting it was run against. Any change makes it stale,
	// aborts an in-flight run, and leaves the user to explicitly analyze the new inputs.
	const pdfInputs = useRef({ data, posting });
	useEffect(() => {
		const changed = pdfInputs.current.data !== data || pdfInputs.current.posting !== posting;
		if (!changed) return;
		pdfInputs.current = { data, posting };
		if (activeSignal.current) {
			activeSignal.current.aborted = true;
			activeSignal.current = null;
		}
		setPdfState({ status: "idle" });
	}, [data, posting]);

	const analyze = async (): Promise<void> => {
		if (pdfState.status === "analyzing") return;

		if (activeSignal.current) activeSignal.current.aborted = true;
		const signal: PdfCheckSignal = { aborted: false };
		activeSignal.current = signal;
		setPdfState({ status: "analyzing" });

		try {
			const pdfReport = await analyzePdf(data, {
				now: now ?? new Date(),
				...(posting.trim() ? { jobDescription: posting.trim() } : {}),
				...(renderPdf ? { renderPdf } : {}),
				...(loadPdfDocument
					? { loadDocument: loadPdfDocument as CheckExportedPdfOptions["loadDocument"] }
					: {}),
				signal,
			});
			if (signal.aborted) return;
			setPdfState({ status: "done", report: pdfReport });
		} catch (error) {
			if (signal.aborted || error instanceof PdfCheckCancelledError) return;
			setPdfState({ status: "error", error: errorMessage(error) });
		} finally {
			if (activeSignal.current === signal) {
				activeSignal.current = null;
				if (signal.aborted && mounted.current) setPdfState({ status: "idle" });
			}
		}
	};

	const pdfReport = pdfState.status === "done" ? pdfState.report : null;

	return (
		<div className="flex flex-col gap-6">
			<p className="text-sm leading-6 text-ink-2">
				Everything here runs against the local draft. The ATS score is deterministic; job coverage and the
				exported-PDF report are shown separately and never sent anywhere.
			</p>

			<section aria-labelledby="check-score-title" className="rounded-md border border-line bg-sunken/30 p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 id="check-score-title" className="text-sm font-semibold text-ink">
							Local ATS score
						</h3>
						<p className="mt-1 text-xs text-ink-3">
							{report.passedRules} of {report.totalRules} applicable rules pass.
						</p>
					</div>
					<p className="font-display text-3xl text-ink" data-testid="ats-score">
						{report.score} / 100
					</p>
				</div>

				<ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="category-breakdown">
					{Object.entries(report.categories).map(([category, categoryScore]) => (
						<li
							key={category}
							data-testid={`category-${category}`}
							className="flex items-center justify-between gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-xs text-ink-2"
						>
							<span>{ATS_CATEGORY_LABELS[category as keyof typeof ATS_CATEGORY_LABELS] ?? category}</span>
							<span className="font-mono text-ink-3">
								{categoryScore.passed} / {categoryScore.total}
							</span>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="check-issues-title">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h3 id="check-issues-title" className="text-sm font-semibold text-ink">
						Issues
					</h3>
					<p className="text-xs text-ink-3">
						{report.counts.error} errors · {report.counts.warning} warnings · {report.counts.info} notes
					</p>
				</div>

				{issues.length === 0 ? (
					<p className="mt-3 rounded-md border border-line bg-sunken/40 px-3 py-4 text-sm text-ink-2">
						No open ATS issues. The local linter found nothing to fix.
					</p>
				) : (
					<ol className="mt-3 flex flex-col gap-2" data-testid="check-issues">
						{issues.map((issue) => {
							const selected = targetsEqual(issue.pageTarget, selectedIssue);
							return (
								<li
									key={issue.key}
									data-issue-code={issue.code}
									data-severity={issue.severity}
									className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<h4 className="text-sm font-semibold text-ink">{issue.title}</h4>
											<Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge>
											<span className="text-xs text-ink-3">{issue.categoryLabel}</span>
										</div>
										<p className="mt-1 font-mono text-[11px] break-all text-ink-3">{issue.pointer}</p>
									</div>

									<div className="flex flex-wrap gap-2">
										{issue.editTarget ? (
											<Button
												size="sm"
												variant="secondary"
												aria-label={`Review ${issue.title} in Write`}
												onClick={() => onReviewIssue(issue)}
											>
												<Icon name="pencil-simple" />
												Review in Write
											</Button>
										) : null}
										{issue.pageTarget ? (
											<Button
												size="sm"
												variant={selected ? "primary" : "secondary"}
												aria-label={`Show ${issue.title} on PDF`}
												aria-pressed={selected ? "true" : "false"}
												onClick={() => onShowOnPdf(issue.pageTarget as PageMapTarget)}
											>
												<Icon name="eye" />
												Show on PDF
											</Button>
										) : null}
									</div>
								</li>
							);
						})}
					</ol>
				)}
			</section>

			<section aria-labelledby="check-job-title">
				<h3 id="check-job-title" className="text-sm font-semibold text-ink">
					Job match
				</h3>
				<p className="mt-1 text-xs leading-5 text-ink-3">
					Coverage compares vocabulary with a pasted posting. It is separate from the ATS score and never leaves this
					process.
				</p>
				<label className="mt-3 flex flex-col gap-1 text-xs font-medium text-ink-2">
					Job description
					<textarea
						className="min-h-28 w-full rounded-md border border-line-2 bg-surface px-3 py-2 text-sm leading-6 text-ink"
						value={posting}
						placeholder="Paste the posting here."
						onChange={(event) => setPosting(event.target.value)}
					/>
				</label>

				{jobMatch ? (
					<div className="mt-3 rounded-md border border-line bg-sunken/30 p-3">
						<p className="text-sm font-semibold text-ink">
							{`Matched ${jobMatch.matchedCount} of ${jobMatch.totalTerms} terms`}
						</p>
						<p className="mt-1 text-xs text-ink-3">
							{`${Math.round(jobMatch.weightedCoverage * 100)}% weighted coverage`}
						</p>
						<div className="mt-3 grid gap-3 sm:grid-cols-2">
							<div>
								<p className="text-xs font-semibold text-ink-2">Matched terms</p>
								<ul data-testid="matched-terms" className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink-2">
									{jobMatch.matchedTerms.map((term) => (
										<li key={term} className="rounded-sm bg-accent-soft px-2 py-0.5 text-accent-text">
											{term}
										</li>
									))}
								</ul>
							</div>
							<div>
								<p className="text-xs font-semibold text-ink-2">Missing terms</p>
								<ul data-testid="missing-terms" className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink-2">
									{jobMatch.missingTerms.map((term) => (
										<li key={term} className="rounded-sm bg-warn-soft px-2 py-0.5 text-warn-text">
											{term}
										</li>
									))}
								</ul>
							</div>
						</div>
					</div>
				) : (
					<p className="mt-3 text-xs text-ink-3">Paste a job description to compare terms.</p>
				)}
			</section>

			<section aria-labelledby="check-pdf-title" className="rounded-md border border-line bg-sunken/30 p-4">
				<h3 id="check-pdf-title" className="text-sm font-semibold text-ink">
					Exported PDF analysis
				</h3>
				<p className="mt-1 text-xs leading-5 text-ink-3">
					Runs only when you ask. It renders the current draft locally, reads the generated PDF, and reports what an
					ATS parser can recover.
				</p>

				<div className="mt-3">
					<Button
						size="sm"
						variant="secondary"
						aria-label="Analyze generated PDF"
						onClick={() => void analyze()}
						loading={pdfState.status === "analyzing"}
						disabled={pdfState.status === "analyzing"}
					>
						<Icon name="file-pdf" />
						{pdfState.status === "analyzing" ? "Analyzing…" : "Analyze generated PDF"}
					</Button>
				</div>

				{pdfState.status === "analyzing" ? (
					<p role="status" className="mt-3 text-xs text-ink-2">
						Analyzing the generated PDF locally…
					</p>
				) : null}

				{pdfState.status === "error" ? (
					<div role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-text">
						PDF analysis failed: {pdfState.error}
					</div>
				) : null}

				{pdfReport ? (
					<div className="mt-4 flex flex-col gap-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm font-semibold text-ink" data-testid="pdf-score">
								PDF score {pdfReport.score} / 100
							</p>
							<p className="text-xs text-ink-3">
								{pdfReport.document.pageCount} page{pdfReport.document.pageCount === 1 ? "" : "s"} ·{" "}
								{pdfReport.passedChecks} of {pdfReport.applicableChecks} checks pass
							</p>
						</div>

						<p className="text-xs text-ink-2">
							{pdfReport.document.operatorsAvailable
								? "Page operators were readable."
								: "The operator pass was unavailable or skipped; operator-dependent checks were skipped."}
						</p>
						<p className="text-xs text-ink-2">Skipped checks: {pdfReport.skippedChecks}</p>
						<p className="text-xs text-ink-2">
							{pdfReport.document.truncated
								? "Truncated: only the first pages were analyzed."
								: "All pages were analyzed."}
						</p>

						<div>
							<p className="text-xs font-semibold text-ink-2">Findings</p>
							{pdfReport.findings.length === 0 ? (
								<p className="mt-1 text-xs text-ink-3">No scored PDF findings.</p>
							) : (
								<ul data-testid="pdf-findings" className="mt-1 flex flex-col gap-1 text-xs text-ink-2">
									{pdfReport.findings.map((finding) => (
										<li
											key={`${finding.code}:${finding.evidence?.page ?? "all"}:${
												finding.evidence?.snippet ?? ""
											}:${JSON.stringify(finding.params ?? {})}`}
										>
											<span className="font-mono text-[11px] text-ink-3">{finding.code}</span>{" "}
											<span>{pdfFindingLabel(finding.code)}</span> ({finding.severity})
										</li>
									))}
								</ul>
							)}
						</div>

						{pdfReport.jd ? (
							<p className="text-xs text-ink-2">
								PDF job coverage: {pdfReport.jd.matchedCount} of {pdfReport.jd.totalTerms} terms matched.
							</p>
						) : null}
					</div>
				) : null}
			</section>
		</div>
	);
}
