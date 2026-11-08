import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { getCheckResult } from "./check-model";

const fixedNow = new Date("2026-01-02T00:00:00.000Z");

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const incompleteResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "";
	data.basics.email = "ada@example.test";
	data.basics.phone = "+1 555 0100";
	data.basics.location = "London";
	data.basics.website.url = "not a url";
	data.summary.content = "<p>Synthetic summary.</p>";
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

describe("getCheckResult", () => {
	it("returns the vendored ATS score, categories, and findings at a fixed clock", () => {
		const { report, issues } = getCheckResult(incompleteResume(), fixedNow);

		expect(report.score).toBe(87);
		expect(report.categories.contact).toEqual({ total: 7, passed: 5 });
		expect(report.categories.dates).toEqual({ total: 5, passed: 4 });
		expect(issues.map((issue) => issue.code)).toEqual(["MISSING_NAME", "MALFORMED_URL", "UNPARSEABLE_DATE"]);
		expect(issues.map((issue) => issue.title)).toEqual([
			"Your name is missing",
			"A link isn't a full address",
			"A date won't be read",
		]);
	});

	it("keeps issue order stable across repeated checks", () => {
		const first = getCheckResult(incompleteResume(), fixedNow);
		const second = getCheckResult(incompleteResume(), fixedNow);

		expect(first.issues.map((issue) => issue.key)).toEqual(second.issues.map((issue) => issue.key));
		expect(first.report.findings.map((finding) => finding.key)).toEqual(
			second.report.findings.map((finding) => finding.key),
		);
	});
});
