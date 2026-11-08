import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { displayedSectionIds, type LayoutColumn } from "../write/resume-edits";

/** The persistent sections a resume can show, by schema key. */
export const SECTION_LABELS = {
	summary: "Summary",
	profiles: "Profiles",
	experience: "Experience",
	education: "Education",
	projects: "Projects",
	skills: "Skills",
	languages: "Languages",
	interests: "Interests",
	awards: "Awards",
	certifications: "Certifications",
	publications: "Publications",
	volunteer: "Volunteer",
	references: "References",
} as const;

export type SectionEntry = { id: string; label: string; hidden: boolean };

/** Resolves one section id to its authored title, falling back to the schema label. */
export const resolveSectionLabel = (data: ResumeData, id: string): string => {
	if (id === "summary") return data.summary.title || SECTION_LABELS.summary;
	const section = (data.sections as Record<string, { title: string } | undefined>)[id];
	if (section) return section.title || (SECTION_LABELS as Record<string, string | undefined>)[id] || id;
	const custom = data.customSections.find((candidate) => candidate.id === id);
	if (custom?.title) return custom.title;
	return id;
};

const isHidden = (data: ResumeData, id: string): boolean => {
	if (id === "summary") return data.summary.hidden;
	const section = (data.sections as Record<string, { hidden: boolean } | undefined>)[id];
	if (section) return section.hidden;
	return data.customSections.find((candidate) => candidate.id === id)?.hidden ?? false;
};

/** Every section the layout editor lists for one page and column. Page 1 appends unplaced sections. */
export const sectionIdsForPage = (
	data: ResumeData,
	pageIndex: number,
	column: LayoutColumn,
): string[] => {
	if (pageIndex === 0) return displayedSectionIds(data, column);
	return [...(data.metadata.layout.pages[pageIndex]?.[column] ?? [])];
};

export const sectionEntriesForPage = (
	data: ResumeData,
	pageIndex: number,
	column: LayoutColumn,
): SectionEntry[] =>
	sectionIdsForPage(data, pageIndex, column).map((id) => ({
		id,
		label: resolveSectionLabel(data, id),
		hidden: isHidden(data, id),
	}));
