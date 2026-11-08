import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { matchPastedJob } from "./job-match";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.summary.content = "<p>Experienced in TypeScript, React and accessible interfaces.</p>";
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
	return data;
};

describe("matchPastedJob", () => {
	it("returns matched and missing terms without folding coverage into the ATS score", () => {
		const report = matchPastedJob(
			syntheticResume(),
			"We need React, TypeScript, GraphQL and Kubernetes experience.",
		);

		expect(report).not.toBeNull();
		expect(report?.matchedTerms).toEqual(expect.arrayContaining(["react", "typescript", "graphql"]));
		expect(report?.missingTerms).toContain("kubernetes");
		expect(report?.matchedCount).toBe(3);
		expect(report?.totalTerms).toBe(4);
		expect(report?.weightedCoverage).toBeGreaterThan(0);
		expect(report?.weightedCoverage).toBeLessThan(1);
	});

	it("returns no report for an empty or whitespace-only posting", () => {
		expect(matchPastedJob(syntheticResume(), "")).toBeNull();
		expect(matchPastedJob(syntheticResume(), "   \n\t ")).toBeNull();
	});
});
