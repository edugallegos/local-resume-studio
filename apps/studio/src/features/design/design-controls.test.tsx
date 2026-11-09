// @vitest-environment happy-dom
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { type Template, templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editResume, type ResumeEdit } from "../write/resume-edits";
import { DENSITY_PRESETS, DesignPanel, FONT_PAIRINGS, SECTION_LABELS } from "./design-panel";
import type { SpillingSections } from "./spill";
import { templateSampleImage, type TemplateThumbnailDependencies } from "./template-thumbnail";

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
	onPreviewTemplate?: (template: Template | null) => void;
	thumbnailsEnabled?: boolean;
	thumbnailDependencies?: TemplateThumbnailDependencies;
	renderedPages?: number | null;
	spillSections?: SpillingSections | null;
	renderStale?: boolean;
};

function Harness({
	initialData,
	onEdit,
	onData,
	onPreviewTemplate,
	thumbnailsEnabled = false,
	thumbnailDependencies,
	renderedPages = null,
	spillSections = null,
	renderStale = false,
}: HarnessProps) {
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
			onPreviewTemplate={onPreviewTemplate}
			thumbnailsEnabled={thumbnailsEnabled}
			thumbnailDependencies={thumbnailDependencies}
			renderedPages={renderedPages}
			spillSections={spillSections}
			renderStale={renderStale}
		/>
	);
}

const setup = (
	data = syntheticResume(),
	options: Pick<
		HarnessProps,
		| "thumbnailsEnabled"
		| "thumbnailDependencies"
		| "renderedPages"
		| "spillSections"
		| "renderStale"
	> = {},
) => {
	const onData = vi.fn<(data: ResumeData) => void>();
	const onEdit = vi.fn<(edit: ResumeEdit) => void>();
	const onPreviewTemplate = vi.fn<(template: Template | null) => void>();
	const user = userEvent.setup();
	render(
		<Harness
			initialData={data}
			onData={onData}
			onEdit={onEdit}
			onPreviewTemplate={onPreviewTemplate}
			{...options}
		/>,
	);
	const latest = (): ResumeData => onData.mock.calls.at(-1)?.[0] ?? data;
	const gallery = (): HTMLElement => screen.getByRole("group", { name: "Template gallery" });
	const card = (template: Template): HTMLElement => {
		const found = gallery().querySelector<HTMLElement>(`[data-template-id="${template}"]`);
		if (!found) throw new Error(`Template card not found: ${template}`);
		return found;
	};
	return { user, latest, onData, onEdit, onPreviewTemplate, gallery, card };
};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("DesignPanel", () => {
	it("offers exactly the 18 pinned templates and writes each template id", async () => {
		const { user, latest, card } = setup();
		const gallery = screen.getByRole("group", { name: "Template gallery" });
		const cards = within(gallery).getAllByRole("button");

		expect(cards).toHaveLength(18);
		expect(cards.map((entry) => entry.getAttribute("data-template-id"))).toEqual([
			...templateSchema.options,
		]);

		for (const template of templateSchema.options) {
			await user.click(card(template));
			expect(latest().metadata.template).toBe(template);
		}
	});

	it("filters the gallery by column count and ATS safety", async () => {
		const { user, gallery } = setup();
		const templateIds = (): (string | null)[] =>
			within(gallery()).getAllByRole("button").map((entry) => entry.getAttribute("data-template-id"));

		expect(screen.getByText("18 of 18 shown")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "One column" }));
		expect(templateIds()).toEqual(
			templateSchema.options.filter((template) => templateLayouts[template].columns === 1),
		);
		expect(screen.getByText("10 of 18 shown")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Two columns" }));
		expect(templateIds()).toEqual(
			templateSchema.options.filter((template) => templateLayouts[template].columns === 2),
		);
		expect(screen.getByText("8 of 18 shown")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "ATS-safe" }));
		expect(templateIds()).toEqual(
			templateSchema.options.filter((template) => templateLayouts[template].atsSafe),
		);
		expect(screen.getByText("10 of 18 shown")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "All" }));
		expect(templateIds()).toHaveLength(18);
	});

	it("marks the applied template as selected", async () => {
		const { user, card } = setup();

		expect(card("onyx").getAttribute("aria-pressed")).toBe("true");
		expect(card("azurill").getAttribute("aria-pressed")).toBe("false");

		await user.click(card("azurill"));

		expect(card("azurill").getAttribute("aria-pressed")).toBe("true");
		expect(card("onyx").getAttribute("aria-pressed")).toBe("false");
	});

	it("previews on hover and focus, then restores on escape, blur, and pointer leave", () => {
		const { onEdit, onPreviewTemplate, card, gallery } = setup();
		const previewed = (): Template | null | undefined => onPreviewTemplate.mock.calls.at(-1)?.[0];

		fireEvent.pointerEnter(card("azurill"), { pointerType: "mouse" });
		expect(previewed()).toBe("azurill");
		expect(onEdit).not.toHaveBeenCalled();

		fireEvent.pointerLeave(gallery());
		expect(previewed()).toBeNull();

		fireEvent.focus(card("persian"));
		expect(previewed()).toBe("persian");

		fireEvent.keyDown(card("persian"), { key: "Escape" });
		expect(previewed()).toBeNull();

		fireEvent.focus(card("lapras"));
		expect(previewed()).toBe("lapras");
		fireEvent.focusOut(card("lapras"), { relatedTarget: document.body });
		expect(previewed()).toBeNull();

		// Previewing the template already in use restores the applied page instead of duplicating it.
		fireEvent.pointerEnter(card("onyx"), { pointerType: "mouse" });
		expect(previewed()).toBeNull();
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("clears the temporary preview and applies a clicked template", async () => {
		const { user, latest, onEdit, onPreviewTemplate, card } = setup();

		fireEvent.pointerEnter(card("azurill"), { pointerType: "mouse" });
		expect(onPreviewTemplate).toHaveBeenLastCalledWith("azurill");

		await user.click(card("azurill"));

		expect(onPreviewTemplate).toHaveBeenLastCalledWith(null);
		expect(onEdit).toHaveBeenCalledWith({ type: "update-template", template: "azurill" });
		expect(latest().metadata.template).toBe("azurill");
	});

	it("previews on a touch hold without applying on release", async () => {
		vi.useFakeTimers();
		try {
			const { onEdit, onPreviewTemplate, card } = setup();
			const azurill = card("azurill");

			fireEvent.pointerDown(azurill, { pointerType: "touch" });
			act(() => {
				vi.advanceTimersByTime(400);
			});
			expect(onPreviewTemplate).toHaveBeenLastCalledWith("azurill");

			fireEvent.pointerUp(azurill, { pointerType: "touch" });
			expect(onPreviewTemplate).toHaveBeenLastCalledWith(null);
			fireEvent.click(azurill);
			expect(onEdit).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps the bundled sample image while a thumbnail render fails", async () => {
		vi.stubGlobal("IntersectionObserver", undefined);
		const renderPdf = vi.fn(async () => {
			throw new Error("thumbnail render failed");
		});
		setup(syntheticResume(), {
			thumbnailsEnabled: true,
			thumbnailDependencies: { renderPdf } as TemplateThumbnailDependencies,
		});

		await waitFor(() => expect(renderPdf).toHaveBeenCalled());
		const azurill = screen
			.getByRole("group", { name: "Template gallery" })
			.querySelector<HTMLImageElement>('[data-template-id="azurill"] img');
		expect(azurill?.getAttribute("src")).toBe(templateSampleImage("azurill"));
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

		await user.click(screen.getByRole("button", { name: "Compact entry layout" }));
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
		const { user, latest, card } = setup(data);

		for (const label of Object.values(SECTION_LABELS)) {
			expect(screen.getByRole("checkbox", { name: `Show ${label}` })).toBeTruthy();
		}

		await user.click(card("lapras"));
		await user.selectOptions(screen.getByLabelText("Font pairing"), FONT_PAIRINGS[1]?.id ?? "inter");

		const next = latest() as ResumeData & { legacyUnknown: unknown };
		expect(next.legacyUnknown).toEqual({ keep: true });
		expect(next.basics).toEqual(data.basics);
		expect(next.summary.content).toBe(data.summary.content);
		expect(next.sections).toEqual(data.sections);
	});

	it("localizes default labels while keeping authored section headings", () => {
		const data = syntheticResume();
		data.metadata.page.locale = "fr-FR";
		data.summary.title = "";
		data.sections.experience.title = "Parcours sur mesure";

		setup(data);

		expect(screen.getByRole("checkbox", { name: "Show Résumé" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Show Parcours sur mesure" })).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: "Show Experience" })).toBeNull();
	});
});

describe("DesignPanel groups", () => {
	it("organizes Design into keyboard-accessible Template, Entries, Type, Color, Page, and Advanced groups", async () => {
		const { user } = setup();
		const nav = screen.getByRole("navigation", { name: "Design groups" });
		const labels = within(nav)
			.getAllByRole("button")
			.map((button) => button.textContent);
		expect(labels).toEqual(["Template", "Entries", "Type", "Color", "Page", "Advanced"]);

		for (const label of labels) {
			const button = within(nav).getByRole("button", { name: label });
			button.focus();
			expect(document.activeElement).toBe(button);
		}

		const advanced = within(nav).getByRole("button", { name: "Advanced" });
		expect(advanced.getAttribute("aria-expanded")).toBe("false");
		await user.click(advanced);
		expect(advanced.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("heading", { name: "Advanced" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Hyphenation" })).toBeTruthy();
	});

	it("offers visual wireframe choices for every entry header layout", async () => {
		const { user, latest } = setup();
		const expected = [
			["Stacked", "stacked"],
			["One line", "inline"],
			["Compact", "compact"],
			["Date column", "date-column"],
			["Eyebrow", "eyebrow"],
		] as const;
		const group = screen.getByRole("group", { name: "Header layout" });

		for (const [label, layout] of expected) {
			const option = within(group).getByRole("button", { name: `${label} entry layout` });
			expect(option.querySelector("[data-entry-wireframe]")).toBeTruthy();
			await user.click(option);
			expect(latest().metadata.design.entry?.layout).toBe(layout);
			expect(option.getAttribute("aria-pressed")).toBe("true");
		}
	});

	it("writes the lead row and entry accent from quick controls", async () => {
		const { user, latest } = setup();

		await user.selectOptions(screen.getByLabelText("Entry lead"), "role");
		expect(latest().metadata.design.entry?.lead).toBe("role");

		await user.selectOptions(screen.getByLabelText("Entry accent"), "band");
		expect(latest().metadata.design.entry?.accent).toBe("band");
	});

	it("offers nine font pairings and all local density choices", async () => {
		const { user, latest } = setup();
		const pairing = screen.getByLabelText("Font pairing");
		expect(within(pairing).getAllByRole("option")).toHaveLength(FONT_PAIRINGS.length);

		for (const option of FONT_PAIRINGS) {
			await user.selectOptions(pairing, option.id);
			expect(latest().metadata.typography.body.fontFamily).toBe(option.body);
			expect(latest().metadata.typography.heading.fontFamily).toBe(option.heading);
		}

		for (const [density, preset] of Object.entries(DENSITY_PRESETS)) {
			await user.selectOptions(screen.getByLabelText("Density"), density);
			expect(latest().metadata.page.gapY).toBe(preset.gapY);
			expect(latest().metadata.typography.body.lineHeight).toBe(preset.bodyLineHeight);
		}
	});
});

describe("DesignPanel color controls", () => {
	it("applies accent swatches with readable labels", async () => {
		const { user, latest } = setup();

		await user.click(screen.getByRole("button", { name: "Ink blue" }));
		expect(latest().metadata.design.colors.primary).toBe("rgba(47, 90, 138, 1)");
	});

	it("accepts valid three- and six-digit hex input and writes rgba", async () => {
		const { user, latest } = setup();
		const custom = screen.getByLabelText("Custom color (hex)");

		await user.clear(custom);
		await user.type(custom, "#0af");
		expect(latest().metadata.design.colors.primary).toBe("rgba(0, 170, 255, 1)");
		expect(custom.getAttribute("aria-invalid")).toBe("false");

		await user.clear(custom);
		await user.type(custom, "#123456");
		expect(latest().metadata.design.colors.primary).toBe("rgba(18, 52, 86, 1)");
	});

	it("rejects invalid hex input without changing the color and explains the format", async () => {
		const { user, latest } = setup();
		const before = latest().metadata.design.colors.primary;
		const custom = screen.getByLabelText("Custom color (hex)");

		await user.clear(custom);
		await user.type(custom, "#12zz00");

		expect(custom.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByText("Use a hex color such as #2F5A8A.")).toBeTruthy();
		expect(latest().metadata.design.colors.primary).toBe(before);
	});

	it("shows contrast guidance for light accents and offers a darker shade", async () => {
		const { user, latest } = setup();
		const custom = screen.getByLabelText("Custom color (hex)");

		await user.clear(custom);
		await user.type(custom, "#ffff00");
		expect(screen.getByRole("status").textContent).toContain("Too light for headings on white");

		await user.click(screen.getByRole("button", { name: "Use a darker shade" }));
		expect(latest().metadata.design.colors.primary).not.toBe("rgba(255, 255, 0, 1)");
		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("DesignPanel advanced controls", () => {
	const openAdvanced = async () => {
		const context = setup();
		await context.user.click(screen.getByRole("button", { name: "Advanced" }));
		return context;
	};

	it("writes exact body and heading families, weights, sizes, line heights, and hyphenation", async () => {
		const { user, latest } = await openAdvanced();

		await user.selectOptions(screen.getByLabelText("Body font family"), "Lato");
		await user.selectOptions(screen.getByLabelText("Heading font family"), "Playfair Display");
		await user.click(screen.getByRole("checkbox", { name: "Body weight 700" }));
		await user.click(screen.getByRole("checkbox", { name: "Body weight 500" }));
		await user.selectOptions(screen.getByLabelText("Heading font weight"), "700");

		const bodySize = screen.getByLabelText("Body font size");
		await user.clear(bodySize);
		await user.type(bodySize, "11.5");
		const bodyLine = screen.getByLabelText("Body line height");
		await user.clear(bodyLine);
		await user.type(bodyLine, "1.6");
		const headingSize = screen.getByLabelText("Heading font size");
		await user.clear(headingSize);
		await user.type(headingSize, "15.5");
		const headingLine = screen.getByLabelText("Heading line height");
		await user.clear(headingLine);
		await user.type(headingLine, "1.25");

		await user.click(screen.getByRole("checkbox", { name: "Hyphenation" }));

		const typography = latest().metadata.typography;
		expect(typography.body).toMatchObject({
			fontFamily: "Lato",
			fontWeights: ["400", "700"],
			fontSize: 11.5,
			lineHeight: 1.6,
		});
		expect(typography.heading).toMatchObject({
			fontFamily: "Playfair Display",
			fontWeights: ["700"],
			fontSize: 15.5,
			lineHeight: 1.25,
		});
		expect(typography.hyphenation).toBe(true);
	});

	it("writes all three design colors and the level display", async () => {
		const { latest } = await openAdvanced();

		fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#123456" } });
		fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#111111" } });
		fireEvent.change(screen.getByLabelText("Background color"), { target: { value: "#fafafa" } });
		fireEvent.change(screen.getByLabelText("Level display"), { target: { value: "progress-bar" } });

		expect(latest().metadata.design.colors).toEqual({
			primary: "rgba(18, 52, 86, 1)",
			text: "rgba(17, 17, 17, 1)",
			background: "rgba(250, 250, 250, 1)",
		});
		expect(latest().metadata.design.level.type).toBe("progress-bar");
	});

	it("writes locale, date format, spacing, and visibility flags", async () => {
		const { user, latest } = await openAdvanced();

		const locale = screen.getByLabelText("Resume language");
		await user.selectOptions(locale, "de-DE");
		await user.selectOptions(screen.getByLabelText("Date format"), "iso");

		const gapX = screen.getByLabelText("Horizontal spacing");
		await user.clear(gapX);
		await user.type(gapX, "2.5");
		const gapY = screen.getByLabelText("Vertical spacing");
		await user.clear(gapY);
		await user.type(gapY, "3.5");

		await user.click(screen.getByRole("checkbox", { name: "Icons in contact line" }));
		await user.click(screen.getByRole("checkbox", { name: "Underline links" }));
		await user.click(screen.getByRole("checkbox", { name: "Section icons" }));

		expect(latest().metadata.page).toMatchObject({
			locale: "de-DE",
			dateFormat: "iso",
			gapX: 2.5,
			gapY: 3.5,
			hideIcons: true,
			hideLinkUnderline: true,
			hideSectionIcons: false,
		});
	});

	it("resets visual defaults while preserving content, page placement, locale, date format, style rules, and stylesheet", async () => {
		const data = syntheticResume();
		data.metadata.page.locale = "de-DE";
		data.metadata.page.dateFormat = "iso";
		data.metadata.styleRules = [
			{
				id: "rule-1",
				enabled: true,
				target: { scope: "global" },
				slots: { heading: { color: "#123456" } },
			},
		] as never;
		data.metadata.stylesheet = { version: 1, css: ".summary { color: red; }" } as never;
		data.metadata.layout.pages.push({ fullWidth: true, main: ["awards"], sidebar: [] });
		const pages = structuredClone(data.metadata.layout.pages);
		const { user, latest } = setup(data);
		await user.click(screen.getByRole("button", { name: "Advanced" }));
		await user.click(screen.getByRole("button", { name: "Reset design defaults" }));

		const next = latest();
		expect(next.basics).toEqual(data.basics);
		expect(next.sections).toEqual(data.sections);
		expect(next.metadata.layout.pages).toEqual(pages);
		expect(next.metadata.page.locale).toBe("de-DE");
		expect(next.metadata.page.dateFormat).toBe("iso");
		expect(next.metadata.styleRules).toEqual(data.metadata.styleRules);
		expect(next.metadata.stylesheet).toEqual(data.metadata.stylesheet);
		expect(next.metadata.typography).toEqual(defaultResumeData.metadata.typography);
		expect(next.metadata.design).toEqual(defaultResumeData.metadata.design);
	});

	it("keeps page and sidebar controls in the Page group and preserves unknown metadata", async () => {
		const data = syntheticResume();
		data.metadata.template = "azurill";
		(data.metadata.layout as unknown as Record<string, unknown>)["x-layout-extra"] = { keep: true };
		const { user, latest } = setup(data);

		await user.selectOptions(screen.getByLabelText("Sidebar side"), "right");
		const width = screen.getByLabelText("Sidebar width");
		await user.clear(width);
		await user.type(width, "38");
		expect(latest().metadata.layout.sidebarSide).toBe("right");
		expect(latest().metadata.layout.sidebarWidth).toBe(38);
		expect((latest().metadata.layout as unknown as Record<string, unknown>)["x-layout-extra"]).toEqual({
			keep: true,
		});

		await user.click(screen.getByRole("button", { name: "Add page" }));
		expect(latest().metadata.layout.pages).toHaveLength(2);
		expect(screen.getByRole("heading", { name: "Page 2" })).toBeTruthy();

		await user.click(screen.getByRole("checkbox", { name: "Full width for page 2" }));
		expect(latest().metadata.layout.pages[1]?.fullWidth).toBe(true);
	});
});

describe("DesignPanel overflow recovery", () => {
	it("moves the sections named by a current applied render when Add page is used", async () => {
		const spillSections: SpillingSections = { main: ["experience"], sidebar: [] };
		const { user, latest, onEdit } = setup(syntheticResume(), {
			renderedPages: 2,
			spillSections,
		});

		expect(screen.getByText(/runs to 2 pages; 1 authored page/i)).toBeTruthy();
		expect(screen.getByText(/Add page moves overflow sections/i)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Add page" }));

		expect(onEdit).toHaveBeenCalledWith({ type: "add-page-with-spill", sections: spillSections });
		expect(latest().metadata.layout.pages).toHaveLength(2);
		expect(latest().metadata.layout.pages[0]?.main).not.toContain("experience");
		expect(latest().metadata.layout.pages[1]?.main).toEqual(["experience"]);
	});

	it("keeps a clearly labeled blank-page action and waits when the render map is stale", async () => {
		const { user, onEdit } = setup(syntheticResume(), {
			renderedPages: 2,
			renderStale: true,
		});

		expect(screen.getByText(/Waiting for the updated preview before moving overflow sections/i)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Add blank page" }));

		expect(onEdit).toHaveBeenCalledWith({ type: "add-page" });
	});

	it("explains an indivisible overflow and keeps the blank-page action available", async () => {
		const { user, onEdit } = setup(syntheticResume(), {
			renderedPages: 2,
			spillSections: null,
		});

		expect(
			screen.getByText(/Automatic movement isn't available for an indivisible overflow section/i),
		).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Add blank page" }));

		expect(onEdit).toHaveBeenCalledWith({ type: "add-page" });
	});
});
