import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { describe, expect, it } from "vitest";
import { editResume } from "../write/resume-edits";
import { resolveSectionLabel, sectionEntriesForPage } from "./section-labels";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.metadata.page.locale = "de-DE";
	data.summary.content = "<p>Synthetic summary.</p>";
	return data;
};

const sectionIds = (data: ResumeData): string[] => ["summary", ...Object.keys(data.sections)];

describe("design section labels", () => {
	it("matches the pinned PDF resolver for every built-in section", () => {
		const data = syntheticResume();

		for (const id of sectionIds(data)) {
			expect(resolveSectionLabel(data, id)).toBe(getResumeSectionTitle(data, id));
		}
		expect(resolveSectionLabel(data, "summary")).toBe("Zusammenfassung");
		expect(resolveSectionLabel(data, "experience")).toBe("Erfahrung");
	});

	it("keeps authored titles while using localized defaults for empty ones", () => {
		const data = syntheticResume();
		data.sections.experience.title = "Authored career history";
		data.summary.title = "";

		expect(resolveSectionLabel(data, "experience")).toBe("Authored career history");
		expect(resolveSectionLabel(data, "summary")).toBe("Zusammenfassung");

		const main = sectionEntriesForPage(data, 0, "main");
		expect(main.find((entry) => entry.id === "summary")?.label).toBe("Zusammenfassung");
		expect(main.find((entry) => entry.id === "experience")?.label).toBe("Authored career history");
	});

	it("resolves the same label after Write edits and locale changes", () => {
		const data = syntheticResume();
		const titled = editResume(data, {
			type: "update-section-title",
			section: "education",
			value: "Academic background",
		});
		expect(resolveSectionLabel(titled, "education")).toBe("Academic background");

		const reset = editResume(titled, {
			type: "update-section-title",
			section: "education",
			value: "",
		});
		expect(resolveSectionLabel(reset, "education")).toBe(getResumeSectionTitle(reset, "education"));
		expect(resolveSectionLabel(reset, "education")).toBe("Ausbildung");

		const french = editResume(reset, { type: "update-page", changes: { locale: "fr-FR" } });
		expect(resolveSectionLabel(french, "education")).toBe("Formation");
		expect(resolveSectionLabel(french, "summary")).toBe("Résumé");
	});
});
