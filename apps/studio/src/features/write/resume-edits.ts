import type { EntryHeader, Page, ResumeData, RoleItem } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { produce } from "immer";

/** Density presets write only the supported gap and line-height paths. */
export const DENSITY_PRESETS = {
	compact: { gapX: 3, gapY: 4, bodyLineHeight: 1.35, headingLineHeight: 1.35 },
	comfortable: { gapX: 4, gapY: 6, bodyLineHeight: 1.5, headingLineHeight: 1.5 },
	spacious: { gapX: 6, gapY: 9, bodyLineHeight: 1.65, headingLineHeight: 1.6 },
} as const;

export type DesignDensity = keyof typeof DENSITY_PRESETS;
export type LayoutColumn = "main" | "sidebar";

/** Resume sections with native add/update/remove/reorder controls in the Write panel. */
export type EditableSection =
	| "profiles"
	| "experience"
	| "education"
	| "projects"
	| "skills"
	| "languages"
	| "certifications";

export type BasicsField =
	| "name"
	| "headline"
	| "email"
	| "phone"
	| "location"
	| "website.url"
	| "website.label";

export type SummaryField = "title" | "content";

/** A partial, caller-supplied item used as the starting point for a new section entry. */
export type NewItemValues = Record<string, unknown>;

/**
 * Every operation names the JSON path it edits. The reducer builds a new document with Immer,
 * so untouched sections, unsupported entries, custom sections, and unknown keys are carried
 * over structurally rather than re-serialized from a view model.
 */
export type ResumeEdit =
	| { type: "update-basics"; field: BasicsField; value: string }
	| { type: "update-summary"; field: SummaryField; value: string }
	| { type: "add-item"; section: EditableSection; item?: NewItemValues }
	| { type: "update-item"; section: EditableSection; id: string; changes: Record<string, unknown> }
	| { type: "remove-item"; section: EditableSection; id: string }
	| { type: "move-item"; section: EditableSection; id: string; toIndex: number }
	| { type: "add-role"; experienceId: string; role?: NewItemValues }
	| { type: "update-role"; experienceId: string; roleId: string; changes: Record<string, unknown> }
	| { type: "remove-role"; experienceId: string; roleId: string }
	| { type: "move-role"; experienceId: string; roleId: string; toIndex: number }
	| { type: "update-template"; template: Template }
	| { type: "update-font-pairing"; body: string; heading: string }
	| { type: "update-density"; density: DesignDensity }
	| { type: "update-entry-layout"; changes: Partial<Pick<EntryHeader, "layout" | "lead" | "accent">> }
	| { type: "update-page"; changes: Partial<Pick<Page, "format" | "marginX" | "marginY">> }
	| { type: "update-text-size"; bodySize: number }
	| { type: "update-accent"; color: string }
	| { type: "set-section-visibility"; sectionId: string; hidden: boolean }
	| { type: "move-section"; sectionId: string; column: LayoutColumn; direction: "up" | "down" }
	| { type: "move-section-to-column"; sectionId: string; column: LayoutColumn };

type RawItem = Record<string, unknown>;
type RawSection = { items: RawItem[] };

const sectionsOf = (data: ResumeData): Record<EditableSection, RawSection> =>
	data.sections as unknown as Record<EditableSection, RawSection>;

const newId = (): string => {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
	// Non-secure fallback for older embedded webviews. IDs only need to be unique within a document.
	return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const website = () => ({ url: "", label: "", inlineLink: false });
const dates = () => ({ start: null, end: null, present: false });

const itemDefaults: Record<EditableSection, () => RawItem> = {
	profiles: () => ({
		id: newId(),
		hidden: false,
		icon: "",
		iconColor: "",
		network: "",
		username: "",
		website: website(),
	}),
	experience: () => ({
		id: newId(),
		hidden: false,
		company: "",
		position: "",
		location: "",
		period: "",
		dates: dates(),
		website: website(),
		description: "",
		roles: [],
	}),
	education: () => ({
		id: newId(),
		hidden: false,
		school: "",
		degree: "",
		area: "",
		grade: "",
		location: "",
		period: "",
		dates: dates(),
		website: website(),
		description: "",
	}),
	projects: () => ({
		id: newId(),
		hidden: false,
		name: "",
		period: "",
		dates: dates(),
		website: website(),
		description: "",
	}),
	skills: () => ({
		id: newId(),
		hidden: false,
		icon: "",
		iconColor: "",
		name: "",
		proficiency: "",
		level: 0,
		keywords: [],
	}),
	languages: () => ({
		id: newId(),
		hidden: false,
		language: "",
		fluency: "",
		level: 0,
	}),
	certifications: () => ({
		id: newId(),
		hidden: false,
		title: "",
		issuer: "",
		date: "",
		dates: dates(),
		website: website(),
		description: "",
	}),
};

/** Build a schema-shaped blank item. Exported for tests and future import flows. */
export const createSectionItem = (section: EditableSection): RawItem => itemDefaults[section]();

/** Build a schema-shaped nested RoleItem for an experience entry. */
export const createExperienceRole = (): RoleItem => ({
	id: newId(),
	position: "",
	period: "",
	dates: dates(),
	description: "",
});

const rolesForExperience = (data: ResumeData, experienceId: string, create = false): RawItem[] | null => {
	const item = sectionsOf(data).experience.items.find((candidate) => candidate.id === experienceId);
	if (!item) return null;
	if (!Array.isArray(item.roles)) {
		if (!create) return null;
		item.roles = [];
	}
	return item.roles as RawItem[];
};

const clampIndex = (index: number, length: number): number => Math.min(Math.max(index, 0), Math.max(length - 1, 0));

const clamp = (value: number, minimum: number, maximum: number): number =>
	Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);

const knownSectionIds = (data: ResumeData): string[] => [
	"summary",
	...Object.keys(data.sections),
	...data.customSections.map((section) => section.id),
];

/**
 * The section IDs the Design panel displays for a column, derived only from the resume's layout arrays.
 * Main appends known sections that are not placed in either column, exactly as the panel presents them.
 */
export const displayedSectionIds = (data: ResumeData, column: LayoutColumn): string[] => {
	const page = data.metadata.layout.pages[0];
	const placedInColumn = (column === "main" ? page?.main : page?.sidebar) ?? [];
	if (column === "sidebar") return [...placedInColumn];

	const placed = new Set([...(page?.main ?? []), ...(page?.sidebar ?? [])]);
	return [...placedInColumn, ...knownSectionIds(data).filter((id) => !placed.has(id))];
};

/**
 * Moves a section between the first authored page's main/sidebar lists. The arrays are the resume's own
 * section-order model, so no parallel design state is introduced.
 */
const placeSection = (data: ResumeData, sectionId: string, column: LayoutColumn): void => {
	const page = data.metadata.layout.pages[0];
	if (!page) return;
	page.main = page.main.filter((id) => id !== sectionId);
	page.sidebar = page.sidebar.filter((id) => id !== sectionId);
	(column === "main" ? page.main : page.sidebar).push(sectionId);
};

export const editResume = (data: ResumeData, edit: ResumeEdit): ResumeData =>
	produce(data, (draft) => {
		switch (edit.type) {
			case "update-basics": {
				if (edit.field === "website.url") draft.basics.website.url = edit.value;
				else if (edit.field === "website.label") draft.basics.website.label = edit.value;
				else draft.basics[edit.field] = edit.value;
				return;
			}

			case "update-summary": {
				draft.summary[edit.field] = edit.value;
				return;
			}

			case "add-item": {
				const section = sectionsOf(draft as ResumeData)[edit.section];
				const defaults = itemDefaults[edit.section]();
				const item = { ...defaults, ...edit.item };
				item.id = typeof edit.item?.id === "string" ? edit.item.id : defaults.id;
				section.items.push(item);
				return;
			}

			case "update-item": {
				const item = sectionsOf(draft as ResumeData)[edit.section].items.find(
					(candidate) => candidate.id === edit.id,
				);
				if (!item) return;

				// A patch can change supported fields but never re-identify the item.
				const { id: _ignoredId, ...changes } = edit.changes;
				Object.assign(item, changes);
				return;
			}

			case "remove-item": {
				const section = sectionsOf(draft as ResumeData)[edit.section];
				const index = section.items.findIndex((candidate) => candidate.id === edit.id);
				if (index === -1) return;
				section.items.splice(index, 1);
				return;
			}

			case "move-item": {
				const section = sectionsOf(draft as ResumeData)[edit.section];
				const from = section.items.findIndex((candidate) => candidate.id === edit.id);
				if (from === -1) return;

				const to = clampIndex(edit.toIndex, section.items.length);
				if (to === from) return;

				const [item] = section.items.splice(from, 1);
				if (item) section.items.splice(to, 0, item);
				return;
			}

			case "add-role": {
				const roles = rolesForExperience(draft as ResumeData, edit.experienceId, true);
				if (!roles) return;

				const defaults = createExperienceRole();
				const role = { ...defaults, ...edit.role };
				role.id = typeof edit.role?.id === "string" ? edit.role.id : defaults.id;
				roles.push(role);
				return;
			}

			case "update-role": {
				const roles = rolesForExperience(draft as ResumeData, edit.experienceId);
				const role = roles?.find((candidate) => candidate.id === edit.roleId);
				if (!role) return;

				// A patch can change supported role fields but never re-identify the role.
				const { id: _ignoredId, ...changes } = edit.changes;
				Object.assign(role, changes);
				return;
			}

			case "remove-role": {
				const roles = rolesForExperience(draft as ResumeData, edit.experienceId);
				const index = roles?.findIndex((candidate) => candidate.id === edit.roleId) ?? -1;
				if (!roles || index === -1) return;
				roles.splice(index, 1);
				return;
			}

			case "move-role": {
				const roles = rolesForExperience(draft as ResumeData, edit.experienceId);
				const from = roles?.findIndex((candidate) => candidate.id === edit.roleId) ?? -1;
				if (!roles || from === -1) return;

				const to = clampIndex(edit.toIndex, roles.length);
				if (to === from) return;

				const [role] = roles.splice(from, 1);
				if (role) roles.splice(to, 0, role);
				return;
			}

			case "update-template": {
				draft.metadata.template = edit.template;
				return;
			}

			case "update-font-pairing": {
				draft.metadata.typography.body.fontFamily = edit.body;
				draft.metadata.typography.heading.fontFamily = edit.heading;
				return;
			}

			case "update-density": {
				const preset = DENSITY_PRESETS[edit.density];
				draft.metadata.page.gapX = preset.gapX;
				draft.metadata.page.gapY = preset.gapY;
				draft.metadata.typography.body.lineHeight = preset.bodyLineHeight;
				draft.metadata.typography.heading.lineHeight = preset.headingLineHeight;
				return;
			}

			case "update-entry-layout": {
				const current = draft.metadata.design.entry ?? {
					layout: "stacked",
					lead: "organization",
					accent: "none",
				};
				draft.metadata.design.entry = {
					layout: edit.changes.layout ?? current.layout,
					lead: edit.changes.lead ?? current.lead,
					accent: edit.changes.accent ?? current.accent,
				};
				return;
			}

			case "update-page": {
				if (edit.changes.format !== undefined) draft.metadata.page.format = edit.changes.format;
				if (edit.changes.marginX !== undefined) {
					draft.metadata.page.marginX = clamp(edit.changes.marginX, 0, 100);
				}
				if (edit.changes.marginY !== undefined) {
					draft.metadata.page.marginY = clamp(edit.changes.marginY, 0, 100);
				}
				return;
			}

			case "update-text-size": {
				const bodySize = clamp(edit.bodySize, 6, 24);
				draft.metadata.typography.body.fontSize = bodySize;
				draft.metadata.typography.heading.fontSize = clamp(bodySize + 4, 6, 24);
				return;
			}

			case "update-accent": {
				draft.metadata.design.colors.primary = edit.color;
				return;
			}

			case "set-section-visibility": {
				if (edit.sectionId === "summary") {
					draft.summary.hidden = edit.hidden;
					return;
				}
				if (Object.hasOwn(draft.sections, edit.sectionId)) {
					(draft.sections as Record<string, { hidden: boolean }>)[edit.sectionId].hidden = edit.hidden;
					return;
				}
				const custom = draft.customSections.find((section) => section.id === edit.sectionId);
				if (custom) custom.hidden = edit.hidden;
				return;
			}

			case "move-section": {
				const page = draft.metadata.layout.pages[0];
				if (!page) return;
				const actual = edit.column === "main" ? page.main : page.sidebar;
				const displayed = displayedSectionIds(draft as ResumeData, edit.column);
				const from = displayed.indexOf(edit.sectionId);
				if (from === -1) return;
				const to = edit.direction === "up" ? from - 1 : from + 1;
				if (to < 0 || to >= displayed.length) return;

				[displayed[from], displayed[to]] = [displayed[to] as string, displayed[from] as string];

				// Both IDs were already persisted: keep the existing in-place swap. A swap that reaches an
				// appended, unplaced section commits the displayed order so the click has a persisted effect.
				if (from < actual.length && to < actual.length) {
					[actual[from], actual[to]] = [actual[to] as string, actual[from] as string];
				} else if (edit.column === "main") {
					page.main = displayed;
				} else {
					page.sidebar = displayed;
				}
				return;
			}

			case "move-section-to-column": {
				placeSection(draft as ResumeData, edit.sectionId, edit.column);
				return;
			}
		}
	});
