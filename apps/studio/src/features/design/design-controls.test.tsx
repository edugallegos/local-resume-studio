// @vitest-environment happy-dom
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editResume, type ResumeEdit } from "../write/resume-edits";
import { DENSITY_PRESETS, DesignPanel, FONT_PAIRINGS, SECTION_LABELS } from "./design-panel";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.summary.content = "<p>Synthetic summary for design controls.</p>";
	return data;
};

type HarnessProps = {
	initialData: ResumeData;
	onEdit?: (edit: ResumeEdit) => void;
	onData?: (data: ResumeData) => void;
};

function Harness({ initialData, onEdit, onData }: HarnessProps) {
	const [data, setData] = useState(initialData);
	return (
		<DesignPanel
			data={data}
			onEdit={(edit) => {
				onEdit?.(edit);
				setData((current) => {
					const next = editResume(current, edit);
					onData?.(next);
					return next;
				});
			}}
		/>
	);
}

const setup = (data = syntheticResume()) => {
	const onData = vi.fn<(data: ResumeData) => void>();
	const onEdit = vi.fn<(edit: ResumeEdit) => void>();
	const user = userEvent.setup();
	render(<Harness initialData={data} onData={onData} onEdit={onEdit} />);
	const latest = (): ResumeData => onData.mock.calls.at(-1)?.[0] ?? data;
	return { user, latest, onData, onEdit };
};

afterEach(() => {
	cleanup();
});

describe("DesignPanel", () => {
	it("offers exactly the 18 pinned templates and writes each template id", async () => {
		const { user, latest } = setup();
		const select = screen.getByLabelText("Template") as HTMLSelectElement;

		expect(select.options).toHaveLength(18);
		expect([...select.options].map((option) => option.value)).toEqual([...templateSchema.options]);

		for (const template of templateSchema.options) {
			await user.selectOptions(select, template);
			expect(latest().metadata.template).toBe(template);
		}
	});

	it("writes supported body and heading font pairings", async () => {
		const { user, latest } = setup();
		const select = screen.getByLabelText("Font pairing");

		for (const pairing of FONT_PAIRINGS) {
			await user.selectOptions(select, pairing.id);
			expect(latest().metadata.typography.body.fontFamily).toBe(pairing.body);
			expect(latest().metadata.typography.heading.fontFamily).toBe(pairing.heading);
		}
	});

	it("writes density, entry layout, and page setup paths", async () => {
		const { user, latest } = setup();

		for (const [density, preset] of Object.entries(DENSITY_PRESETS)) {
			await user.selectOptions(screen.getByLabelText("Density"), density);
			expect(latest().metadata.page.gapX).toBe(preset.gapX);
			expect(latest().metadata.page.gapY).toBe(preset.gapY);
			expect(latest().metadata.typography.body.lineHeight).toBe(preset.bodyLineHeight);
			expect(latest().metadata.typography.heading.lineHeight).toBe(preset.headingLineHeight);
		}

		await user.selectOptions(screen.getByLabelText("Entry layout"), "compact");
		expect(latest().metadata.design.entry?.layout).toBe("compact");

		await user.selectOptions(screen.getByLabelText("Entry lead"), "role");
		expect(latest().metadata.design.entry?.lead).toBe("role");

		await user.selectOptions(screen.getByLabelText("Entry accent"), "band");
		expect(latest().metadata.design.entry?.accent).toBe("band");

		await user.selectOptions(screen.getByLabelText("Page size"), "letter");
		expect(latest().metadata.page.format).toBe("letter");

		const horizontal = screen.getByLabelText("Horizontal margin");
		await user.clear(horizontal);
		await user.type(horizontal, "24");
		expect(latest().metadata.page.marginX).toBe(24);

		const vertical = screen.getByLabelText("Vertical margin");
		await user.clear(vertical);
		await user.type(vertical, "18");
		expect(latest().metadata.page.marginY).toBe(18);
	});

	it("writes text size and accent color", () => {
		const { latest } = setup();
		const size = screen.getByLabelText("Text size");
		fireEvent.change(size, { target: { value: "12" } });

		expect(latest().metadata.typography.body.fontSize).toBe(12);
		expect(latest().metadata.typography.heading.fontSize).toBe(16);

		fireEvent.change(screen.getByLabelText("Accent color"), { target: { value: "#123456" } });
		expect(latest().metadata.design.colors.primary).toBe("rgba(18, 52, 86, 1)");
	});

	it("reorders sections, moves them between columns, and toggles visibility", async () => {
		const { user, latest } = setup();
		const page = () => latest().metadata.layout.pages[0];

		expect(page()?.main.slice(0, 2)).toEqual(["summary", "experience"]);
		await user.click(screen.getByRole("button", { name: "Move Experience up" }));
		expect(page()?.main.slice(0, 2)).toEqual(["experience", "summary"]);

		expect(page()?.sidebar).toContain("skills");
		await user.click(screen.getByRole("button", { name: "Move Skills to main" }));
		expect(page()?.sidebar).not.toContain("skills");
		expect(page()?.main).toContain("skills");

		expect(latest().metadata.layout.pages[0]?.main).toContain("experience");
		await user.click(screen.getByRole("checkbox", { name: "Show Languages" }));
		expect(latest().sections.languages.hidden).toBe(true);

		await user.click(screen.getByRole("checkbox", { name: "Show Summary" }));
		expect(latest().summary.hidden).toBe(true);
	});

	it("places an unplaced custom section when its enabled Move up control is used", async () => {
		const data = syntheticResume() as ResumeData & { legacyUnknown: unknown };
		data.legacyUnknown = { keep: true };
		const customId = "custom-distinctive-archive";
		data.customSections = [
			{
				id: customId,
				type: "projects",
				title: "Distinctive Custom Archive",
				icon: "",
				columns: 1,
				hidden: false,
				showHeading: true,
				keepTogether: false,
				startOnNewPage: false,
				items: [],
			},
		];
		const { user, latest } = setup(data);
		const page = () => latest().metadata.layout.pages[0];

		expect(page()?.main).not.toContain(customId);
		expect(screen.getByRole("checkbox", { name: "Show Distinctive Custom Archive" })).toBeTruthy();

		const moveUp = screen.getByRole("button", { name: "Move Distinctive Custom Archive up" });
		expect(moveUp).toHaveProperty("disabled", false);
		await user.click(moveUp);

		const main = page()?.main ?? [];
		expect(main).toContain(customId);
		expect(main.at(-2)).toBe(customId);
		expect((latest() as ResumeData & { legacyUnknown: unknown }).legacyUnknown).toEqual({ keep: true });
	});

	it("labels every visible section and writes only the supported design paths", async () => {
		const data = syntheticResume() as ResumeData & { legacyUnknown: unknown };
		data.legacyUnknown = { keep: true };
		const { user, latest } = setup(data);

		for (const label of Object.values(SECTION_LABELS)) {
			expect(screen.getByRole("checkbox", { name: `Show ${label}` })).toBeTruthy();
		}

		await user.selectOptions(screen.getByLabelText("Template"), "lapras");
		await user.selectOptions(screen.getByLabelText("Font pairing"), FONT_PAIRINGS[1]?.id ?? "inter");

		const next = latest() as ResumeData & { legacyUnknown: unknown };
		expect(next.legacyUnknown).toEqual({ keep: true });
		expect(next.basics).toEqual(data.basics);
		expect(next.summary.content).toBe(data.summary.content);
		expect(next.sections).toEqual(data.sections);
	});
});
