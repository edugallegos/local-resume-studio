import type { AtsReport } from "@reactive-resume/resume/ats";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { type CheckIssue, toCheckIssue } from "./issue-model";

export type CheckResult = {
	report: AtsReport;
	issues: CheckIssue[];
};

/** The deterministic local ATS report and its mapped, actionable issues. */
export const getCheckResult = (data: ResumeData, now: Date = new Date()): CheckResult => {
	const report = lintResumeForAts(data, { now });
	return {
		report,
		issues: report.findings.map((finding) => toCheckIssue(finding, data)),
	};
};
