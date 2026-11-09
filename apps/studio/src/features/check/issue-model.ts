import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { AtsCategory, AtsFinding, AtsRuleCode, AtsSeverity } from "@reactive-resume/resume/ats";
import { atsRuleCategory } from "@reactive-resume/resume/ats";
import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";

/** A field the existing Write tab exposes, so Check can send the user straight there. */
export type CheckEditTarget = {
	fieldId: string;
	label: string;
};

export type CheckIssue = {
	key: string;
	code: AtsRuleCode;
	pointer: string;
	title: string;
	category: AtsCategory;
	categoryLabel: string;
	severity: AtsSeverity;
	editTarget: CheckEditTarget | null;
	pageTarget: PageMapTarget | null;
	/** Structured finding values (for example the exact malformed URL) used for parser-view matching. */
	params?: AtsFinding["params"];
};

/** The pinned v6.1.0 Check titles, with section-aware variants resolved by `issueTitle`. */
export const CHECK_ISSUE_TITLES: Readonly<Record<AtsRuleCode, string>> = {
	MISSING_NAME: "Your name is missing",
	MISSING_EMAIL: "No email address",
	MALFORMED_EMAIL: "Email address won't be recognized",
	MISSING_PHONE: "No phone number",
	MISSING_LOCATION: "No location",
	MALFORMED_URL: "A link isn't a full address",
	PICTURE_PRESENT: "Your resume has a photo",
	EMPTY_PERIOD: "An entry has no dates",
	UNPARSEABLE_PERIOD: "Dates won't be read",
	UNPARSEABLE_DATE: "A date won't be read",
	REVERSED_PERIOD: "Dates run backwards",
	FUTURE_DATED_PERIOD: "Dates start in the future",
	SECTION_MISSING_FROM_LAYOUT: "This section never prints",
	NO_VISIBLE_EXPERIENCE: "No work experience shows",
	MISSING_EXPERIENCE_DESCRIPTION: "A role has no description",
	FRAGMENTED_ENTRY: "Looks like part of the entry above",
	NON_STANDARD_SECTION_TITLE: "Section heading is atypical",
	MULTI_COLUMN_PROSE_SECTION: "Prose is split into columns",
	PROSE_SECTION_IN_SIDEBAR: "Prose sits in the sidebar",
	TWO_COLUMN_LAYOUT: "Sidebar is read after the main column",
	SMALL_BODY_FONT: "Body text is very small",
	TIGHT_LINE_HEIGHT: "Lines are packed tightly",
	TIGHT_PAGE_MARGINS: "Margins are very narrow",
};

export const ATS_CATEGORY_LABELS: Readonly<Record<AtsCategory, string>> = {
	contact: "Contact details",
	dates: "Dates",
	layout: "Layout",
	headings: "Section headings",
	writing: "Writing",
};

const SECTION_LABELS: Readonly<Record<string, string>> = {
	profiles: "Profiles",
	experience: "Experience",
	education: "Education",
	projects: "Projects",
	skills: "Skills",
	languages: "Languages",
	certifications: "Certifications",
};

const EDITABLE_SECTIONS = new Set<SectionType>([
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"certifications",
]);

const DEFAULT_ITEM_FIELD: Partial<Record<SectionType, string>> = {
	profiles: "network",
	experience: "company",
	education: "school",
	projects: "name",
	skills: "name",
	languages: "language",
	certifications: "title",
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
	name: "Full name",
	headline: "Headline",
	email: "Email",
	phone: "Phone",
	location: "Location",
	"website-url": "Website URL",
	"website-label": "Website label",
	title: "Title",
	content: "Content",
	company: "Company",
	position: "Position",
	school: "School",
	degree: "Degree",
	area: "Area of study",
	grade: "Grade",
	network: "Network",
	username: "Username",
	proficiency: "Proficiency",
	keywords: "Keywords",
	language: "Language",
	fluency: "Fluency",
	issuer: "Issuer",
	date: "Date",
	period: "Period",
	description: "Description",
};

const decodeToken = (token: string): string => token.replace(/~1/g, "/").replace(/~0/g, "~");

const pointerTokens = (pointer: string): string[] =>
	pointer
		.split("/")
		.slice(1)
		.map(decodeToken);

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-");

const itemFieldId = (section: SectionType, itemId: string, field: string): string =>
	`write-${section}-${safeId(itemId)}-${safeId(field.replace(".", "-"))}`;

const roleFieldId = (experienceId: string, roleId: string, field: string): string =>
	`write-experience-${safeId(experienceId)}-role-${safeId(roleId)}-${safeId(field)}`;

const fieldLabel = (section: SectionType, field: string, itemIndex?: number): string => {
	const label = FIELD_LABELS[field] ?? field.replaceAll("-", " ");
	const sectionLabel = SECTION_LABELS[section] ?? section;
	return `${sectionLabel}${itemIndex === undefined ? "" : ` ${itemIndex + 1}`} · ${label}`;
};

const itemAt = (data: ResumeData, section: SectionType, indexToken: string | undefined) => {
	const sectionData = data.sections[section] as unknown as { items?: { id?: unknown; roles?: unknown[] }[] };
	const item = sectionData.items?.[Number(indexToken ?? -1)];
	return item && typeof item === "object" && typeof item.id === "string" ? item : null;
};

const sectionNameFor = (data: ResumeData, sectionId: string | undefined): string => {
	if (!sectionId) return "This section";
	if (sectionId === "summary") return data.summary.title.trim() || "Summary";
	if (sectionId in data.sections) {
		const section = data.sections[sectionId as SectionType];
		return section.title.trim() || SECTION_LABELS[sectionId] || sectionId;
	}
	const custom = data.customSections.find((candidate) => candidate.id === sectionId);
	if (!custom) return sectionId;
	return custom.title.trim() || SECTION_LABELS[custom.type] || custom.type;
};

const sectionIdFromTokens = (tokens: readonly string[], data: ResumeData): string | undefined => {
	const [head, second] = tokens;
	if (head === "summary") return "summary";
	if (head === "sections") return second;
	if (head === "customSections") return data.customSections[Number(second)]?.id;
	return undefined;
};

const issueTitle = (finding: AtsFinding, data: ResumeData, tokens: readonly string[]): string => {
	const section = sectionIdFromTokens(tokens, data);
	const params = finding.params ?? {};

	switch (finding.code) {
		case "SECTION_MISSING_FROM_LAYOUT":
			return `${sectionNameFor(data, section)} never prints`;
		case "NON_STANDARD_SECTION_TITLE":
			return `“${String(params.title ?? "")}” isn't a heading systems look for`;
		case "MULTI_COLUMN_PROSE_SECTION":
			return `${sectionNameFor(data, section)} is split into ${Number(params.columns ?? 2)} columns`;
		case "PROSE_SECTION_IN_SIDEBAR":
			return `${sectionNameFor(data, section)} sits in the sidebar`;
		default:
			return CHECK_ISSUE_TITLES[finding.code];
	}
};

/**
 * Maps a JSON pointer to the Write field and page-map target it can reveal. It only returns actions for
 * controls the native editor actually exposes; unsupported imported fields stay diagnostic-only.
 */
export const toCheckIssue = (finding: AtsFinding, data: ResumeData): CheckIssue => {
	const tokens = pointerTokens(finding.pointer);
	const [head, second, third, fourth, fifth, sixth] = tokens;

	let editTarget: CheckEditTarget | null = null;
	let pageTarget: PageMapTarget | null = null;

	if (head === "basics" || head === "picture") {
		pageTarget = { kind: "header" };
		if (head === "basics") {
			if (second === "website" && (third === "url" || third === "label")) {
				const field = `website-${third}`;
				editTarget = {
					fieldId: `write-basics-${field}`,
					label: `Basics · ${FIELD_LABELS[field] ?? field}`,
				};
			} else if (
				second !== undefined &&
				second in FIELD_LABELS &&
				second !== "title" &&
				second !== "content"
			) {
				editTarget = {
					fieldId: `write-basics-${second}`,
					label: `Basics · ${FIELD_LABELS[second] ?? second}`,
				};
			}
		}
	} else if (head === "summary") {
		pageTarget = { kind: "section", sectionId: "summary" };
		if (second === "title") {
			editTarget = { fieldId: "write-summary-heading", label: "Summary · Summary title" };
		} else if (second === "content") {
			editTarget = { fieldId: "write-summary-content", label: "Summary · Summary content" };
		}
	} else if (head === "sections" && second !== undefined && second in data.sections) {
		const section = second as SectionType;
		pageTarget = { kind: "section", sectionId: section };
		const item = third === "items" ? itemAt(data, section, fourth) : null;

		if (item) {
			pageTarget = { kind: "item", sectionId: section, itemId: String(item.id) };
			if (EDITABLE_SECTIONS.has(section)) {
				if (fifth === "roles" && sixth !== undefined) {
					const role = item.roles?.[Number(sixth)] as { id?: unknown; period?: unknown } | undefined;
					if (role && typeof role.id === "string") {
						const roleField = tokens[6] === "period" ? "period" : (tokens[6] ?? "position");
						editTarget = {
							fieldId: roleFieldId(String(item.id), role.id, roleField),
							label: `${SECTION_LABELS[section] ?? section} ${Number(fourth) + 1} · Role · ${
								FIELD_LABELS[roleField] ?? roleField
							}`,
						};
					}
				} else {
					const rawField = tokens[4];
					const field =
						rawField === "website" ? `website-${tokens[5] ?? "url"}` : (rawField ?? DEFAULT_ITEM_FIELD[section]);
					if (field) {
						editTarget = {
							fieldId: itemFieldId(section, String(item.id), field),
							label: fieldLabel(section, field, Number(fourth)),
						};
					}
				}
			}
		} else if (third === undefined && EDITABLE_SECTIONS.has(section)) {
			editTarget = {
				fieldId: `write-section-${section}-title`,
				label: `${SECTION_LABELS[section] ?? section} section`,
			};
		}
	} else if (head === "customSections") {
		const custom = data.customSections[Number(second)];
		if (custom) {
			pageTarget = { kind: "section", sectionId: custom.id };
			if (third === "items" && fourth !== undefined) {
				const item = custom.items[Number(fourth)] as { id?: unknown } | undefined;
				if (item && typeof item.id === "string") {
					pageTarget = { kind: "item", sectionId: custom.id, itemId: item.id };
				}
			}
		}
	}

	const category = atsRuleCategory(finding.code);
	return {
		key: finding.key,
		code: finding.code,
		pointer: finding.pointer,
		title: issueTitle(finding, data, tokens),
		category,
		categoryLabel: ATS_CATEGORY_LABELS[category],
		severity: finding.severity,
		editTarget,
		pageTarget,
		...(finding.params ? { params: finding.params } : {}),
	};
};
