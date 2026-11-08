import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { describe, expect, it } from "vitest";
import { pageTargetLabel, writeFieldIdForPageTarget } from "./write-focus";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.summary.title = "Profile";
	data.sections.experience.title = "Experience";
	data.sections.experience.items = [
		{
			id: "experience-1",
			hidden: false,
			company: "Analytical Engine Works",
			position: "Programmer",
			location: "",
			period: "",
			dates: { start: null, end: null, present: false },
			website: { url: "", label: "", inlineLink: false },
			description: "",
			roles: [],
		},
	];
	return data;
};

describe("Write focus mapping for preview targets", () => {
	it("maps header, summary, section, and item targets to stable Write controls", () => {
		const data = syntheticResume();

		expect(writeFieldIdForPageTarget(data, { kind: "header" })).toBe("write-basics-name");
		expect(writeFieldIdForPageTarget(data, { kind: "section", sectionId: "summary" })).toBe(
			"write-summary-content",
		);
		expect(writeFieldIdForPageTarget(data, { kind: "section", sectionId: "experience" })).toBe(
			"write-section-experience-title",
		);
		expect(
			writeFieldIdForPageTarget(data, {
				kind: "item",
				sectionId: "experience",
				itemId: "experience-1",
			}),
		).toBe("write-experience-experience-1-company");
	});

	it("does not invent a Write control for sections or entries the native editor cannot edit", () => {
		const data = syntheticResume();

		expect(writeFieldIdForPageTarget(data, { kind: "section", sectionId: "awards" })).toBeNull();
		expect(
			writeFieldIdForPageTarget(data, {
				kind: "item",
				sectionId: "awards",
				itemId: "award-1",
			}),
		).toBeNull();
		expect(
			writeFieldIdForPageTarget(data, {
				kind: "item",
				sectionId: "experience",
				itemId: "missing",
			}),
		).toBeNull();
	});

	it("labels preview targets with the resume's own section and entry titles", () => {
		const data = syntheticResume();

		expect(pageTargetLabel(data, { kind: "header" })).toBe("Header: Ada Lovelace");
		expect(pageTargetLabel(data, { kind: "section", sectionId: "summary" })).toBe("Profile section");
		expect(
			pageTargetLabel(data, {
				kind: "item",
				sectionId: "experience",
				itemId: "experience-1",
			}),
		).toBe("Experience 1: Analytical Engine Works");
	});
});
