import type { createResumePdfBlob } from "@reactive-resume/pdf/browser";
import type { analyzePdfResume, harvestPdfDocument, matchJobDescription } from "@reactive-resume/resume/ats-pdf";
import type { buildMarkdown } from "@reactive-resume/resume/markdown";
import { type ResumeData, parseResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { lintResumeForAts } from "@reactive-resume/resume/ats";

const PINNED_TEMPLATE_IDS = [
	"azurill",
	"bronzor",
	"chikorita",
	"ditgar",
	"ditto",
	"gengar",
	"glalie",
	"kakuna",
	"lapras",
	"leafish",
	"meowth",
	"onyx",
	"persian",
	"pikachu",
	"porygon",
	"rhyhorn",
	"scizor",
	"smeargle",
] as const;

/**
 * The Task 1 workspace export surface. Type-only imports make `pnpm typecheck` cover the vendored PDF, ATS, and
 * Markdown closures without loading browser-only WASM modules in this Node test.
 */
type PinnedWorkspaceExports = [
	typeof createResumePdfBlob,
	typeof buildMarkdown,
	typeof matchJobDescription,
	typeof analyzePdfResume,
	typeof harvestPdfDocument,
	typeof lintResumeForAts,
	typeof defaultResumeData,
	typeof templateSchema,
	typeof templateLayouts,
];

const pinnedWorkspaceExports = null as unknown as PinnedWorkspaceExports;
void pinnedWorkspaceExports;

/** A synthetic resume that has the shape accepted by Reactive Resume v6.1.0. */
const syntheticV610Resume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);

	data.basics = {
		...data.basics,
		name: "Ada Lovelace",
		headline: "Analytical Engine Programmer",
		email: "ada@example.test",
		phone: "+44 20 0000 0000",
		location: "London, UK",
		website: { url: "https://example.test/ada", label: "example.test/ada" },
	};

	data.summary.content = "<p>Synthetic resume used to verify the pinned vendor baseline.</p>";

	data.sections.experience.items = [
		{
			id: "experience-1",
			hidden: false,
			company: "Analytical Engines Ltd",
			position: "Programmer",
			location: "London, UK",
			period: "1842 – 1843",
			website: { url: "https://example.test/engines", label: "example.test/engines", inlineLink: false },
			description: "<p>Wrote the first published algorithm for an analytical engine.</p>",
			roles: [],
		},
	];

	return data;
};

describe("pinned Reactive Resume v6.1.0 vendor baseline", () => {
	it("parses a synthetic v6.1.0 resume", () => {
		const parsed = parseResumeData(syntheticV610Resume());

		expect(parsed.basics.name).toBe("Ada Lovelace");
		expect(parsed.sections.experience.items).toHaveLength(1);
		expect(parsed.sections.experience.items[0]?.company).toBe("Analytical Engines Ltd");
		expect(parsed.metadata.template).toBe("onyx");
	});

	it("registers exactly the 18 baseline templates", () => {
		expect(templateSchema.options).toHaveLength(18);
		expect([...templateSchema.options]).toEqual([...PINNED_TEMPLATE_IDS]);
		expect(Object.keys(templateLayouts).sort()).toEqual([...PINNED_TEMPLATE_IDS].sort());
	});

	it("reports MISSING_NAME from the pinned ATS engine", () => {
		const data = syntheticV610Resume();
		data.basics.name = "";

		const report = lintResumeForAts(parseResumeData(data), { now: new Date("2026-01-01T00:00:00.000Z") });
		const missingName = report.findings.find((finding) => finding.code === "MISSING_NAME");

		expect(missingName).toMatchObject({ code: "MISSING_NAME", pointer: "/basics/name", severity: "error" });
	});
});
