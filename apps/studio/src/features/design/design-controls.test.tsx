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
};

function Harness({
	initialData,
	onEdit,
	onData,
	onPreviewTemplate,
	thumbnailsEnabled = false,
	thumbnailDependencies,
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
		/>
	);
}

const setup = (
	data = syntheticResume(),
	options: Pick<HarnessProps, "thumbnailsEnabled" | "thumbnailDependencies"> = {},
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
});
