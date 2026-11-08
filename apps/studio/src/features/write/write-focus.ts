import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { resolveSectionLabel } from "../design/section-labels";
import type { EditableSection } from "./resume-edits";

const EDITABLE_SECTIONS = new Set<EditableSection>([
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"certifications",
]);

/** The first Write control the native editor renders for each editable entry type. */
const FIRST_ITEM_FIELD: Record<EditableSection, string> = {
	profiles: "network",
	experience: "company",
	education: "school",
	projects: "name",
	skills: "name",
	languages: "language",
	certifications: "title",
};

/** The value that best names an entry in the preview, matching the first field where possible. */
const ITEM_TITLE_FIELD: Record<string, string> = {
	profiles: "network",
	experience: "company",
	education: "school",
	projects: "name",
	skills: "name",
	languages: "language",
	certifications: "title",
	awards: "title",
	publications: "title",
	volunteer: "organization",
	references: "name",
};

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-");

export const writeSectionHeadingId = (section: EditableSection): string => `write-section-${section}-title`;

export const writeItemFieldId = (section: EditableSection, itemId: string, key: string): string =>
	`write-${section}-${safeId(itemId)}-${safeId(key)}`;

const isEditableSection = (sectionId: string): sectionId is EditableSection =>
	EDITABLE_SECTIONS.has(sectionId as EditableSection);

type RawItem = Record<string, unknown>;

const itemsFor = (data: ResumeData, sectionId: string): RawItem[] => {
	const section = (data.sections as Record<string, { items?: unknown[] } | undefined>)[sectionId];
	return (section?.items ?? []).filter(
		(item): item is RawItem => typeof item === "object" && item !== null && !Array.isArray(item),
	);
};

const itemFor = (data: ResumeData, sectionId: string, itemId: string): { item: RawItem; index: number } | null => {
	const items = itemsFor(data, sectionId);
	const index = items.findIndex((item) => String(item.id) === itemId);
	const item = items[index];
	return item ? { item, index } : null;
};

/** The Write field a preview target reveals, or null when the native editor has no matching control. */
export const writeFieldIdForPageTarget = (data: ResumeData, target: PageMapTarget): string | null => {
	if (target.kind === "header") return "write-basics-name";
	if (target.kind === "section") {
		if (target.sectionId === "summary") return "write-summary-content";
		return isEditableSection(target.sectionId) ? writeSectionHeadingId(target.sectionId) : null;
	}
	if (!isEditableSection(target.sectionId)) return null;
	if (!itemFor(data, target.sectionId, target.itemId)) return null;
	return writeItemFieldId(target.sectionId, target.itemId, FIRST_ITEM_FIELD[target.sectionId]);
};

/** A human-readable label for an interactive page-map control. */
export const pageTargetLabel = (data: ResumeData, target: PageMapTarget): string => {
	if (target.kind === "header") {
		return `Header: ${data.basics.name.trim() || "Resume"}`;
	}

	const sectionLabel = resolveSectionLabel(data, target.sectionId);
	if (target.kind === "section") return `${sectionLabel} section`;

	const found = itemFor(data, target.sectionId, target.itemId);
	if (!found) return `${sectionLabel} entry`;
	const titleField = ITEM_TITLE_FIELD[target.sectionId];
	const value = titleField ? found.item[titleField] : undefined;
	const title = typeof value === "string" ? value.trim() : "";
	return title ? `${sectionLabel} ${found.index + 1}: ${title}` : `${sectionLabel} ${found.index + 1}`;
};
