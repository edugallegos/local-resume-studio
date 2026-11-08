import type { PageMap, PageMapNode } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { describe, expect, it } from "vitest";
import { editResume } from "../write/resume-edits";
import { spillingSections } from "./spill";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.metadata.layout.pages = [
		{
			fullWidth: false,
			main: ["summary", "experience"],
			sidebar: ["skills", "languages"],
		},
	];
	return data;
};

const sectionNode = (sectionId: string, page: number): PageMapNode => ({
	kind: "section",
	sectionId,
	key: `page-${page + 1}/section-${sectionId}`,
	page,
	x: 0,
	y: 0,
	width: 100,
	height: 20,
});

const pageMap = (nodes: PageMapNode[]): PageMap => ({
	pages: Array.from({ length: Math.max(1, ...nodes.map((node) => node.page + 1)) }, () => ({
		width: 595,
		height: 842,
	})),
	nodes,
});

describe("spillingSections", () => {
	it("moves every last-page section whose first rendered page is beyond the authored pages, keeping columns", () => {
		const data = syntheticResume();
		const map = pageMap([
			sectionNode("summary", 0),
			sectionNode("experience", 1),
			sectionNode("experience", 2),
			sectionNode("skills", 0),
			sectionNode("languages", 1),
		]);

		expect(spillingSections(data.metadata.layout.pages, map)).toEqual({
			main: ["experience"],
			sidebar: ["languages"],
		});
	});

	it("falls back to the last crossing section in the main column when none start beyond the page", () => {
		const data = syntheticResume();
		const map = pageMap([
			sectionNode("summary", 0),
			sectionNode("experience", 0),
			sectionNode("experience", 1),
			sectionNode("skills", 0),
			sectionNode("languages", 0),
		]);

		expect(spillingSections(data.metadata.layout.pages, map)).toEqual({ main: ["experience"], sidebar: [] });
	});

	it("falls back to the sidebar only when the main column has no crossing section", () => {
		const data = syntheticResume();
		data.metadata.layout.pages[0] = {
			fullWidth: false,
			main: ["summary"],
			sidebar: ["skills", "languages"],
		};
		const map = pageMap([
			sectionNode("summary", 0),
			sectionNode("skills", 0),
			sectionNode("skills", 1),
			sectionNode("languages", 0),
		]);

		expect(spillingSections(data.metadata.layout.pages, map)).toEqual({ main: [], sidebar: ["skills"] });
	});

	it("returns null when the only crossing section is alone in its column", () => {
		const data = syntheticResume();
		data.metadata.layout.pages[0] = {
			fullWidth: false,
			main: ["experience"],
			sidebar: ["skills"],
		};
		const map = pageMap([
			sectionNode("experience", 0),
			sectionNode("experience", 1),
			sectionNode("skills", 0),
			sectionNode("skills", 1),
		]);

		expect(spillingSections(data.metadata.layout.pages, map)).toBeNull();
	});

	it("returns null without a usable page map or rendered section nodes", () => {
		const data = syntheticResume();
		expect(spillingSections(data.metadata.layout.pages, undefined)).toBeNull();
		expect(spillingSections(data.metadata.layout.pages, pageMap([sectionNode("summary", 0)]))).toBeNull();
	});
});

describe("add-page-with-spill edit", () => {
	it("moves the selected sections to a new page in one edit and keeps column, full width, and unknown page metadata", () => {
		const data = syntheticResume();
		data.metadata.layout.pages[0] = {
			fullWidth: true,
			main: ["summary", "experience", "education"],
			sidebar: [],
			"x-page-note": { keep: true },
		} as ResumeData["metadata"]["layout"]["pages"][number];

		const next = editResume(data, {
			type: "add-page-with-spill",
			sections: { main: ["experience"], sidebar: [] },
		});

		expect(next.metadata.layout.pages).toHaveLength(2);
		expect(next.metadata.layout.pages[0]?.main).toEqual(["summary", "education"]);
		expect(next.metadata.layout.pages[1]).toMatchObject({
			fullWidth: true,
			main: ["experience"],
			sidebar: [],
			"x-page-note": { keep: true },
		});
		expect(
			(data.metadata.layout.pages[0] as unknown as Record<string, unknown>)["x-page-note"],
		).toEqual({ keep: true });
	});
});
