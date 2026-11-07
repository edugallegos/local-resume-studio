import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { describe, expect, it } from "vitest";
import { type EditableSection, editResume } from "./resume-edits";

type RawSection = { items: Record<string, unknown>[] };

const editableSections: EditableSection[] = [
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"certifications",
];

const sectionsOf = (data: ResumeData): Record<EditableSection, RawSection> =>
	data.sections as unknown as Record<EditableSection, RawSection>;

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const fixture = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.basics.phone = "+44 20 0000 0000";
	data.basics.location = "London, United Kingdom";
	data.basics.website = { url: "https://example.test/ada", label: "example.test" };
	data.summary.title = "Summary";
	data.summary.content = "<p>Synthetic summary used by edit tests.</p>";

	for (const section of editableSections) {
		sectionsOf(data)[section].items = [
			{
				id: `${section}-1`,
				hidden: false,
				[`${section}Value`]: "first",
				"x-unknown-item-key": { kept: true },
			},
			{ id: `${section}-2`, hidden: false, [`${section}Value`]: "second" },
		];
	}

	sectionsOf(data).experience.items[0] = {
		...sectionsOf(data).experience.items[0],
		company: "Analytical Engines Ltd",
		roles: [
			{
				id: "role-1",
				position: "Analyst",
				period: "1840",
				dates: { start: "1840", end: null, present: false },
				description: "<p>First synthetic role.</p>",
				"x-unknown-role-key": { kept: true },
			},
			{
				id: "role-2",
				position: "Programmer",
				period: "1841",
				dates: { start: "1841", end: null, present: false },
				description: "<p>Second synthetic role.</p>",
			},
		],
	};

	// Unsupported content that the Write panel must never rewrite.
	data.sections.awards.items = [
		{ id: "award-1", hidden: false, title: "Synthetic award", "x-award-extra": 7 },
	] as never;
	data.sections.publications.items = [
		{ id: "publication-1", hidden: false, title: "Synthetic publication" },
	] as never;
	data.sections.volunteer.items = [
		{ id: "volunteer-1", hidden: false, organization: "Synthetic charity" },
	] as never;

	data.customSections = [
		{
			id: "custom-1",
			title: "Synthetic custom section",
			icon: "note",
			columns: 1,
			hidden: false,
			showHeading: true,
			keepTogether: false,
			startOnNewPage: false,
			type: "projects",
			items: [{ id: "custom-item-1", hidden: false, name: "Custom project", "x-custom-extra": "kept" }],
		},
	] as never;

	// Unknown document keys must survive every edit.
	return Object.assign(data, { "x-document-version": 9, "x-legacy": { nested: true } }) as ResumeData;
};

const firstId = (section: EditableSection): string => `${section}-1`;
const secondId = (section: EditableSection): string => `${section}-2`;

const idList = (data: ResumeData, section: EditableSection): string[] =>
	sectionsOf(data)[section].items.map((item) => String(item.id));

const experienceRoles = (data: ResumeData, experienceId = firstId("experience")): Record<string, unknown>[] => {
	const item = sectionsOf(data).experience.items.find((candidate) => candidate.id === experienceId);
	return (item?.roles as Record<string, unknown>[] | undefined) ?? [];
};

const roleIdList = (data: ResumeData): string[] => experienceRoles(data).map((role) => String(role.id));

describe("editResume basics and summary", () => {
	it.each([
		["name", (data: ResumeData, value: string) => (data.basics.name = value)],
		["headline", (data: ResumeData, value: string) => (data.basics.headline = value)],
		["email", (data: ResumeData, value: string) => (data.basics.email = value)],
		["phone", (data: ResumeData, value: string) => (data.basics.phone = value)],
		["location", (data: ResumeData, value: string) => (data.basics.location = value)],
	])("updates basics.%s without mutating other content", (field, apply) => {
		const original = fixture();
		const snapshot = structuredClone(original);
		const expected = structuredClone(original);
		apply(expected, "Updated value");

		const next = editResume(original, {
			type: "update-basics",
			field: field as "name" | "headline" | "email" | "phone" | "location",
			value: "Updated value",
		});

		expect(next.basics).toEqual(expected.basics);
		expect(original).toEqual(snapshot);
		expect(next).not.toBe(original);
		expect(next.sections).toEqual(original.sections);
		expect((next as ResumeData & { "x-document-version": number })["x-document-version"]).toBe(9);
	});

	it.each([
		["website.url", "https://example.test/updated"],
		["website.label", "Updated label"],
	])("updates basics.%s only", (field, value) => {
		const original = fixture();
		const next = editResume(original, {
			type: "update-basics",
			field: field as "website.url" | "website.label",
			value,
		});

		if (field === "website.url") expect(next.basics.website.url).toBe(value);
		else expect(next.basics.website.label).toBe(value);
		expect(original.basics.website).toEqual({ url: "https://example.test/ada", label: "example.test" });
	});

	it.each(["title", "content"] as const)("updates summary.%s", (field) => {
		const original = fixture();
		const next = editResume(original, { type: "update-summary", field, value: "Updated summary" });

		expect(next.summary[field]).toBe("Updated summary");
		expect(original.summary[field]).not.toBe("Updated summary");
		expect(next.summary.hidden).toBe(original.summary.hidden);
	});
});

describe("editResume section items", () => {
	const defaultField: Record<EditableSection, string> = {
		profiles: "network",
		experience: "company",
		education: "school",
		projects: "name",
		skills: "name",
		languages: "language",
		certifications: "title",
	};

	it.each(editableSections)("adds an empty %s item with schema defaults", (section) => {
		const original = fixture();
		const snapshot = structuredClone(original);

		const next = editResume(original, { type: "add-item", section });
		const items = sectionsOf(next)[section].items;

		expect(items).toHaveLength(3);
		expect(items[2]).toMatchObject({ hidden: false });
		expect(items[2]?.id).toEqual(expect.any(String));
		expect(String(items[2]?.id)).not.toBe("");
		expect(items[2]).toHaveProperty(defaultField[section]);
		expect(items[0]).toEqual(sectionsOf(original)[section].items[0]);
		expect(original).toEqual(snapshot);
	});

	it.each(editableSections)("adds schema-valid default values for %s", (section) => {
		const original = structuredClone(defaultResumeData);
		const next = editResume(original, { type: "add-item", section });

		expect(() => parseResumeData(next)).not.toThrow();
	});

	it("accepts caller-provided initial item values while keeping defaults", () => {
		const original = fixture();
		const next = editResume(original, {
			type: "add-item",
			section: "languages",
			item: { id: "language-new", language: "Spanish", fluency: "Fluent", level: 4 },
		});

		expect(sectionsOf(next).languages.items[2]).toMatchObject({
			id: "language-new",
			hidden: false,
			language: "Spanish",
			fluency: "Fluent",
			level: 4,
		});
	});

	it.each(editableSections)("updates one %s item and preserves unknown item keys", (section) => {
		const original = fixture();
		const snapshot = structuredClone(original);
		const expected = structuredClone(original);
		sectionsOf(expected)[section].items[0] = {
			...sectionsOf(expected)[section].items[0],
			[defaultField[section]]: "Updated",
		};

		const next = editResume(original, {
			type: "update-item",
			section,
			id: firstId(section),
			changes: { [defaultField[section]]: "Updated", id: "must-not-change" },
		});

		expect(sectionsOf(next)[section].items[0]).toEqual(sectionsOf(expected)[section].items[0]);
		expect(sectionsOf(next)[section].items[0]?.id).toBe(firstId(section));
		expect(sectionsOf(next)[section].items[0]?.["x-unknown-item-key"]).toEqual({ kept: true });
		expect(sectionsOf(next)[section].items[1]).toEqual(sectionsOf(original)[section].items[1]);
		expect(original).toEqual(snapshot);
	});

	it.each(editableSections)("removes a %s item by id", (section) => {
		const original = fixture();
		const snapshot = structuredClone(original);

		const next = editResume(original, { type: "remove-item", section, id: firstId(section) });

		expect(idList(next, section)).toEqual([secondId(section)]);
		expect(idList(original, section)).toEqual([firstId(section), secondId(section)]);
		expect(original).toEqual(snapshot);
	});

	it.each(editableSections)("reorders %s items by target index", (section) => {
		const original = fixture();
		const snapshot = structuredClone(original);

		const next = editResume(original, {
			type: "move-item",
			section,
			id: firstId(section),
			toIndex: 1,
		});

		expect(idList(next, section)).toEqual([secondId(section), firstId(section)]);
		expect(idList(original, section)).toEqual([firstId(section), secondId(section)]);
		expect(original).toEqual(snapshot);
	});

	it("clamps reorder targets instead of dropping items", () => {
		const original = fixture();
		const next = editResume(original, { type: "move-item", section: "projects", id: firstId("projects"), toIndex: 99 });
		expect(idList(next, "projects")).toEqual([secondId("projects"), firstId("projects")]);

		const back = editResume(next, { type: "move-item", section: "projects", id: secondId("projects"), toIndex: -10 });
		expect(idList(back, "projects")).toEqual([secondId("projects"), firstId("projects")]);
	});

	it("leaves the document unchanged for an unknown item id", () => {
		const original = fixture();
		const next = editResume(original, {
			type: "update-item",
			section: "experience",
			id: "missing-id",
			changes: { company: "Nope" },
		});
		expect(next).toBe(original);
	});
});

describe("editResume nested experience roles", () => {
	it("adds a schema-valid nested role with pinned defaults", () => {
		const base = editResume(structuredClone(defaultResumeData), { type: "add-item", section: "experience" });
		const experienceId = String(sectionsOf(base).experience.items[0]?.id);
		const snapshot = structuredClone(base);

		const next = editResume(base, { type: "add-role", experienceId });
		const roles = experienceRoles(next, experienceId);

		expect(roles).toHaveLength(1);
		expect(roles[0]).toMatchObject({ position: "", period: "", description: "" });
		expect(roles[0]?.dates).toEqual({ start: null, end: null, present: false });
		expect(roles[0]?.id).toEqual(expect.any(String));
		expect(String(roles[0]?.id)).not.toBe("");
		expect(() => parseResumeData(next)).not.toThrow();
		expect(base).toEqual(snapshot);
	});

	it("accepts caller-provided initial nested role values", () => {
		const original = fixture();
		const next = editResume(original, {
			type: "add-role",
			experienceId: firstId("experience"),
			role: {
				id: "role-new",
				position: "Lead Programmer",
				period: "1843",
				dates: { start: "1843", end: null, present: true },
				description: "<p>Synthetic lead role.</p>",
			},
		});

		expect(experienceRoles(next)[2]).toMatchObject({
			id: "role-new",
			position: "Lead Programmer",
			period: "1843",
			description: "<p>Synthetic lead role.</p>",
		});
	});

	it("updates a nested role, preserves unknown role keys, and leaves everything else unchanged", () => {
		const original = fixture();
		const snapshot = structuredClone(original);
		const parentCompany = sectionsOf(original).experience.items[0]?.company;

		const next = editResume(original, {
			type: "update-role",
			experienceId: firstId("experience"),
			roleId: "role-1",
			changes: { position: "Lead Analyst", description: "<p>Updated.</p>", id: "must-not-change" },
		});

		const roles = experienceRoles(next);
		expect(roles[0]).toMatchObject({
			id: "role-1",
			position: "Lead Analyst",
			description: "<p>Updated.</p>",
			"x-unknown-role-key": { kept: true },
		});
		expect(roles[1]).toEqual(experienceRoles(original)[1]);
		expect(sectionsOf(next).experience.items[0]?.company).toBe(parentCompany);
		expect(next.basics).toEqual(original.basics);
		expect(next.sections.awards).toEqual(original.sections.awards);
		expect(next.customSections).toEqual(original.customSections);
		expect((next as ResumeData & { "x-legacy": unknown })["x-legacy"]).toEqual({ nested: true });
		expect(original).toEqual(snapshot);
	});

	it("removes a nested role by id without mutating the input", () => {
		const original = fixture();
		const snapshot = structuredClone(original);

		const next = editResume(original, {
			type: "remove-role",
			experienceId: firstId("experience"),
			roleId: "role-1",
		});

		expect(roleIdList(next)).toEqual(["role-2"]);
		expect(roleIdList(original)).toEqual(["role-1", "role-2"]);
		expect(original).toEqual(snapshot);
	});

	it("reorders nested roles and clamps out-of-range targets", () => {
		const original = fixture();
		const snapshot = structuredClone(original);

		const next = editResume(original, {
			type: "move-role",
			experienceId: firstId("experience"),
			roleId: "role-1",
			toIndex: 1,
		});
		expect(roleIdList(next)).toEqual(["role-2", "role-1"]);

		const clamped = editResume(next, {
			type: "move-role",
			experienceId: firstId("experience"),
			roleId: "role-2",
			toIndex: 99,
		});
		expect(roleIdList(clamped)).toEqual(["role-1", "role-2"]);

		expect(roleIdList(original)).toEqual(["role-1", "role-2"]);
		expect(original).toEqual(snapshot);
	});

	it("leaves the document unchanged for unknown parent or role ids", () => {
		const original = fixture();
		const missingParent = editResume(original, {
			type: "update-role",
			experienceId: "missing-experience",
			roleId: "role-1",
			changes: { position: "Nope" },
		});
		const missingRole = editResume(original, {
			type: "update-role",
			experienceId: firstId("experience"),
			roleId: "missing-role",
			changes: { position: "Nope" },
		});

		expect(missingParent).toBe(original);
		expect(missingRole).toBe(original);
	});
});

describe("editResume preservation", () => {
	it("keeps unsupported sections, custom sections, and unknown keys structurally unchanged", () => {
		const original = fixture();
		const snapshot = structuredClone(original);

		const next = editResume(
			editResume(original, { type: "update-basics", field: "name", value: "Ada Updated" }),
			{ type: "update-item", section: "experience", id: firstId("experience"), changes: { company: "Analytical" } },
		);

		expect(next.sections.awards).toEqual(original.sections.awards);
		expect(next.sections.publications).toEqual(original.sections.publications);
		expect(next.sections.volunteer).toEqual(original.sections.volunteer);
		expect(next.customSections).toEqual(original.customSections);
		expect(next.metadata).toEqual(original.metadata);
		expect((next as ResumeData & { "x-legacy": unknown })["x-legacy"]).toEqual({ nested: true });
		expect(sectionsOf(next).experience.items[0]?.["x-unknown-item-key"]).toEqual({ kept: true });
		expect(original).toEqual(snapshot);
	});

	it("does not add defaults to unsupported sections when a supported section is edited", () => {
		const original = fixture();
		const next = editResume(original, { type: "add-item", section: "profiles" });

		expect(next.sections.awards).toEqual(original.sections.awards);
		expect(next.sections.interests).toEqual(original.sections.interests);
		expect(next.sections.references).toEqual(original.sections.references);
		expect(next.customSections).toEqual(original.customSections);
	});
});
