// @vitest-environment happy-dom
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSectionItem, type EditableSection, editResume } from "./resume-edits";
import { sectionDefinitions } from "./sections/section-editor";
import { WritePanel } from "./write-panel";

const editableSections: EditableSection[] = [
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"certifications",
];

const identifyingField: Record<EditableSection, { key: string; label: string }> = {
	profiles: { key: "network", label: "network" },
	experience: { key: "company", label: "company" },
	education: { key: "school", label: "school" },
	projects: { key: "name", label: "project name" },
	skills: { key: "name", label: "skill" },
	languages: { key: "language", label: "language" },
	certifications: { key: "title", label: "certification title" },
};

const singular: Record<EditableSection, string> = {
	profiles: "profile",
	experience: "experience",
	education: "education",
	projects: "project",
	skills: "skill",
	languages: "language",
	certifications: "certification",
};

const hostileHtml = [
	"<p>Hello <strong>world</strong>.</p>",
	"<script>window.__resumePwned = true</script>",
	'<img src="https://tracker.example.test/pixel.png" onerror="window.__resumePwned = true">',
	'<image src="https://tracker.example.test/alias.png">',
	'<iframe src="https://evil.example.test/frame"></iframe>',
	'<video src="https://evil.example.test/movie.mp4" autoplay></video>',
	'<a href="javascript:window.__resumePwned = true">click</a>',
].join("");

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const fixture = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = hostileHtml;

	const sections = data.sections as unknown as Record<
		EditableSection,
		{ items: Record<string, unknown>[] }
	>;

	for (const section of editableSections) {
		const { key } = identifyingField[section];
		sections[section].items = [
			{ ...createSectionItem(section), id: `${section}-1`, [key]: "First value" },
			{ ...createSectionItem(section), id: `${section}-2`, [key]: "Second value" },
		];
	}

	sections.experience.items[0] = {
		...sections.experience.items[0],
		description: hostileHtml,
		roles: [
			{
				id: "role-1",
				position: "First role",
				period: "1840",
				dates: { start: "1840", end: null, present: false },
				description: hostileHtml,
				"x-unknown-role-key": { kept: true },
			},
			{
				id: "role-2",
				position: "Second role",
				period: "1841",
				dates: { start: "1841", end: null, present: false },
				description: "<p>Second synthetic role.</p>",
			},
		],
	};
	sections.education.items[0] = { ...sections.education.items[0], description: hostileHtml };
	sections.projects.items[0] = { ...sections.projects.items[0], description: hostileHtml };
	sections.certifications.items[0] = { ...sections.certifications.items[0], description: hostileHtml };

	return data;
};

function Harness({
	initial,
	onData,
}: {
	initial: ResumeData;
	onData?: (data: ResumeData) => void;
}) {
	const [data, setData] = useState(initial);
	return (
		<WritePanel
			data={data}
			onEdit={(edit) => {
				setData((current) => {
					const next = editResume(current, edit);
					onData?.(next);
					return next;
				});
			}}
		/>
	);
}

const fieldName = (section: EditableSection, index: number): RegExp =>
	new RegExp(`${singular[section]} ${index}: ${identifyingField[section].label}`, "i");

afterEach(() => {
	cleanup();
	delete (window as Window & { __resumePwned?: boolean }).__resumePwned;
});

describe("WritePanel", () => {
	it("renders accessible basics, summary, and section controls", () => {
		render(<Harness initial={fixture()} />);

		expect(screen.getByLabelText("Full name")).toBeTruthy();
		expect(screen.getByLabelText("Headline")).toBeTruthy();
		expect(screen.getByLabelText("Email")).toBeTruthy();
		expect(screen.getByLabelText("Summary content")).toBeTruthy();

		for (const section of editableSections) {
			expect(screen.getByRole("button", { name: `Add ${singular[section]}` })).toBeTruthy();
			expect(screen.getByLabelText(fieldName(section, 1))).toBeTruthy();
			expect(screen.getByLabelText(fieldName(section, 2))).toBeTruthy();
		}

		expect(screen.getByLabelText(/profile 1: website url/i)).toBeTruthy();
		expect(screen.getByLabelText(/skill 1: keywords/i)).toBeTruthy();
		expect(screen.getByLabelText(/language 1: level \(0–5\)/i)).toBeTruthy();

		// A preview-selected section focuses its heading programmatically.
		expect(document.getElementById("write-section-experience-title")?.tabIndex).toBe(-1);
	});

	it("edits basics fields without changing the stored summary HTML", async () => {
		const user = userEvent.setup();
		const initial = fixture();
		const summary = initial.summary.content;
		render(<Harness initial={initial} />);

		const name = screen.getByLabelText("Full name");
		await user.clear(name);
		await user.type(name, "Ada Updated");

		expect(name).toHaveProperty("value", "Ada Updated");
		expect(screen.getByLabelText("Summary content")).toHaveProperty("value", summary);
		expect(initial.summary.content).toBe(summary);
	});

	it.each(editableSections)("adds, reorders, and removes %s entries", async (section) => {
		const user = userEvent.setup();
		const label = singular[section];
		render(<Harness initial={fixture()} />);

		expect(screen.getByLabelText(fieldName(section, 1))).toHaveProperty("value", "First value");

		await user.click(screen.getByRole("button", { name: `Add ${label}` }));
		expect(screen.getByLabelText(fieldName(section, 3))).toHaveProperty("value", "");

		await user.click(screen.getByRole("button", { name: `Move ${label} 2 up` }));
		expect(screen.getByLabelText(fieldName(section, 1))).toHaveProperty("value", "Second value");
		expect(screen.getByLabelText(fieldName(section, 2))).toHaveProperty("value", "First value");

		await user.click(screen.getByRole("button", { name: `Remove ${label} 1` }));
		expect(screen.getByLabelText(fieldName(section, 1))).toHaveProperty("value", "First value");
		expect(screen.queryByLabelText(fieldName(section, 3))).toBeNull();
	});

	it.each(editableSections)("edits a %s entry field through the same immutable path", async (section) => {
		const user = userEvent.setup();
		render(<Harness initial={fixture()} />);

		const field = screen.getByLabelText(fieldName(section, 1));
		await user.clear(field);
		await user.type(field, "Edited value");

		expect(field).toHaveProperty("value", "Edited value");
		expect(screen.getByLabelText(fieldName(section, 2))).toHaveProperty("value", "Second value");
	});

	it("updates skill keywords and numeric levels through accessible controls", async () => {
		const user = userEvent.setup();
		render(<Harness initial={fixture()} />);

		const keywords = screen.getByLabelText(/skill 1: keywords/i);
		await user.clear(keywords);
		await user.type(keywords, "TypeScript, React");

		expect(keywords).toHaveProperty("value", "TypeScript, React");

		const level = screen.getByLabelText(/skill 1: level \(0–5\)/i);
		await user.clear(level);
		await user.type(level, "5");
		expect(level).toHaveProperty("value", "5");
	});

	it("adds, edits, reorders, and removes nested experience roles", async () => {
		const user = userEvent.setup();
		render(<Harness initial={fixture()} />);

		const firstPosition = screen.getByLabelText(/experience 1 role 1: position/i);
		expect(firstPosition).toHaveProperty("value", "First role");
		expect(screen.getByLabelText(/experience 1 role 2: position/i)).toHaveProperty("value", "Second role");

		await user.clear(firstPosition);
		await user.type(firstPosition, "Lead Analyst");
		expect(firstPosition).toHaveProperty("value", "Lead Analyst");

		await user.click(screen.getByRole("button", { name: /add role to experience 1/i }));
		expect(screen.getByLabelText(/experience 1 role 3: position/i)).toHaveProperty("value", "");

		await user.click(screen.getByRole("button", { name: /move role 2 up in experience 1/i }));
		expect(screen.getByLabelText(/experience 1 role 1: position/i)).toHaveProperty("value", "Second role");
		expect(screen.getByLabelText(/experience 1 role 2: position/i)).toHaveProperty("value", "Lead Analyst");

		await user.click(screen.getByRole("button", { name: /remove role 1 from experience 1/i }));
		expect(screen.getByLabelText(/experience 1 role 1: position/i)).toHaveProperty("value", "Lead Analyst");
		expect(screen.queryByLabelText(/experience 1 role 3: position/i)).toBeNull();
	});

	it("sanitizes hostile rich text in every preview without altering stored content", async () => {
		const initial = fixture();
		const user = userEvent.setup();
		const { container } = render(<Harness initial={initial} />);

		const previews = container.querySelectorAll("[data-rich-text-preview]");
		expect(previews.length).toBeGreaterThanOrEqual(6);

		for (const preview of Array.from(previews)) {
			const html = preview.innerHTML.toLowerCase();
			expect(html).not.toContain("<script");
			expect(html).not.toContain("<img");
			expect(html).not.toContain("<image");
			expect(html).not.toContain("<iframe");
			expect(html).not.toContain("<video");
			expect(html).not.toContain("onerror");
			expect(html).not.toContain("javascript:");
			expect(html).not.toContain("src=");
			expect(html).not.toContain("href=");
		}

		expect(container.querySelectorAll("img, image, iframe, video, audio, source").length).toBe(0);
		expect(screen.getByLabelText("Summary formatted preview").textContent).toContain("Hello world");
		expect((window as Window & { __resumePwned?: boolean }).__resumePwned).toBeUndefined();

		// The stored HTML stays hostile until the user edits that field.
		expect(screen.getByLabelText("Summary content")).toHaveProperty("value", hostileHtml);
		expect(initial.summary.content).toBe(hostileHtml);
		expect(initial.sections.experience.items[0]?.description).toBe(hostileHtml);
		expect(
			(initial.sections.experience.items[0]?.roles as { description?: string }[] | undefined)?.[0]?.description,
		).toBe(hostileHtml);

		// Editing an unrelated field leaves the stored rich text byte-for-byte intact.
		const name = screen.getByLabelText("Full name");
		await user.type(name, "!");
		expect(screen.getByLabelText("Summary content")).toHaveProperty("value", hostileHtml);
	});

	it("keeps raw HTML in the editable field while the safe preview omits resources", async () => {
		const user = userEvent.setup();
		render(<Harness initial={fixture()} />);
		const summary = screen.getByLabelText("Summary content");

		await user.clear(summary);
		await user.type(summary, "<p>New <em>safe</em> copy</p><img src='https://remote.example.test/a.png'>");

		expect(summary).toHaveProperty(
			"value",
			"<p>New <em>safe</em> copy</p><img src='https://remote.example.test/a.png'>",
		);
		const preview = screen.getByLabelText("Summary formatted preview");
		expect(preview.innerHTML).toContain("<em>safe</em>");
		expect(preview.innerHTML.toLowerCase()).not.toContain("<img");
		expect(preview.querySelector("img")).toBeNull();
	});

	it("selects the output language without overwriting authored headings or content", async () => {
		const user = userEvent.setup();
		const initial = fixture();
		initial.metadata.page.locale = "en-US";
		initial.summary.title = "";
		initial.sections.experience.title = "Authored career history";
		initial.summary.content = "<p>Keep this authored summary.</p>";
		const onData = vi.fn<(data: ResumeData) => void>();
		render(<Harness initial={initial} onData={onData} />);

		const select = screen.getByRole("combobox", { name: "Resume language" });
		expect(select).toHaveProperty("value", "en-US");
		await user.selectOptions(select, "de-DE");

		const next = onData.mock.calls.at(-1)?.[0] as ResumeData;
		expect(next.metadata.page.locale).toBe("de-DE");
		expect(next.summary.content).toBe("<p>Keep this authored summary.</p>");
		expect(next.sections.experience.title).toBe("Authored career history");
		expect(screen.getByLabelText("Summary heading").getAttribute("placeholder")).toBe("Zusammenfassung");
		expect(screen.getByRole("heading", { name: "Zusammenfassung" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Authored career history" })).toBeTruthy();
	});

	it("edits and resets the summary and every native section heading", async () => {
		const user = userEvent.setup();
		const initial = fixture();
		initial.metadata.page.locale = "de-DE";
		render(<Harness initial={initial} />);

		const summary = screen.getByLabelText("Summary heading");
		expect(summary).toHaveProperty("value", "");
		expect(summary.getAttribute("placeholder")).toBe("Zusammenfassung");

		await user.type(summary, "Career summary");
		expect(summary).toHaveProperty("value", "Career summary");
		expect(screen.getByRole("heading", { name: "Career summary" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Reset Summary heading to default" }));
		expect(summary).toHaveProperty("value", "");
		expect(screen.getByRole("heading", { name: "Zusammenfassung" })).toBeTruthy();

		for (const section of editableSections) {
			const label = `${sectionDefinitions[section].title} heading`;
			const expected = getResumeSectionTitle(initial, section);
			const input = screen.getByLabelText(label);
			expect(input).toHaveProperty("value", "");
			expect(input.getAttribute("placeholder")).toBe(expected);

			await user.type(input, `Custom ${section}`);
			expect(input).toHaveProperty("value", `Custom ${section}`);
			expect(screen.getByRole("heading", { name: `Custom ${section}` })).toBeTruthy();

			await user.click(screen.getByRole("button", { name: `Reset ${label} to default` }));
			expect(input).toHaveProperty("value", "");
			expect(screen.getByRole("heading", { name: expected })).toBeTruthy();
		}
	});

	it("writes a custom heading through the edit flow without rewriting items or unknown fields", async () => {
		const user = userEvent.setup();
		const initial = fixture() as ResumeData & { "x-document-version": number };
		initial["x-document-version"] = 9;
		const onData = vi.fn<(data: ResumeData) => void>();
		render(<Harness initial={initial} onData={onData} />);

		const input = screen.getByLabelText("Experience heading");
		await user.type(input, "Career history");

		const next = onData.mock.calls.at(-1)?.[0] as ResumeData & { "x-document-version": number };
		expect(next.sections.experience.title).toBe("Career history");
		expect(next.sections.experience.items).toEqual(initial.sections.experience.items);
		expect(next.sections.awards).toEqual(initial.sections.awards);
		expect(next.summary).toEqual(initial.summary);
		expect(next["x-document-version"]).toBe(9);
	});
});
