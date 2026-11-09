// @vitest-environment happy-dom
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { getLanguageName, supportedLocales } from "@reactive-resume/utils/locale";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editResume } from "./write/resume-edits";
import { LocaleSelect } from "./locale-select";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.summary.content = "<p>Synthetic summary used by locale tests.</p>";
	return Object.assign(data, { "x-document-version": 9 }) as ResumeData;
};

function Harness({ initial, onData }: { initial: ResumeData; onData?: (data: ResumeData) => void }) {
	const [data, setData] = useState(initial);
	return (
		<LocaleSelect
			id="test-resume-locale"
			value={data.metadata.page.locale}
			onChange={(locale) => {
				setData((current) => {
					const next = editResume(current, { type: "update-page", changes: { locale } });
					onData?.(next);
					return next;
				});
			}}
		/>
	);
}

const optionValues = (select: HTMLElement): string[] =>
	within(select)
		.getAllByRole("option")
		.map((option) => (option as HTMLOptionElement).value);

afterEach(() => {
	cleanup();
});

describe("LocaleSelect", () => {
	it("offers every pinned locale by name and code without the pseudo-locale", () => {
		render(<Harness initial={syntheticResume()} />);
		const select = screen.getByRole("combobox", { name: "Resume language" });

		expect(optionValues(select)).toEqual([...supportedLocales]);
		expect(optionValues(select)).not.toContain("zu-ZA");

		const options = within(select).getAllByRole("option") as HTMLOptionElement[];
		for (const locale of supportedLocales) {
			const option = options.find((candidate) => candidate.value === locale);
			expect(option).toBeTruthy();
			expect(option?.textContent).toContain(locale);
			expect(option?.textContent).toContain(getLanguageName(locale));
		}

		expect(screen.getByText(/changes default section headings, date words, and text direction/i)).toBeTruthy();
		expect(screen.getByText(/does not translate your content/i)).toBeTruthy();
	});

	it("shows the current locale and writes only metadata.page.locale", async () => {
		const user = userEvent.setup();
		const initial = syntheticResume();
		initial.metadata.page.locale = "de-DE";
		initial.metadata.page.dateFormat = "iso";
		initial.sections.experience.title = "Authored career history";
		const before = structuredClone(initial);
		const snapshot = structuredClone(initial);
		const onData = vi.fn<(data: ResumeData) => void>();

		render(<Harness initial={initial} onData={onData} />);
		const select = screen.getByRole("combobox", { name: "Resume language" });
		expect(select).toHaveProperty("value", "de-DE");

		await user.selectOptions(select, "fr-FR");

		const next = onData.mock.calls.at(-1)?.[0] as ResumeData;
		expect(next.metadata.page.locale).toBe("fr-FR");
		expect(next.metadata.page.dateFormat).toBe("iso");
		expect(next.basics).toEqual(before.basics);
		expect(next.summary).toEqual(before.summary);
		expect(next.sections).toEqual(before.sections);
		expect(next.customSections).toEqual(before.customSections);
		expect(next.metadata.design).toEqual(before.metadata.design);
		expect(next.metadata.typography).toEqual(before.metadata.typography);
		expect((next as ResumeData & { "x-document-version": number })["x-document-version"]).toBe(9);
		expect(initial).toEqual(snapshot);
	});

	it("keeps an imported unsupported locale visible without making it a translated choice", () => {
		const data = syntheticResume();
		data.metadata.page.locale = "x-synthetic";
		render(<Harness initial={data} />);

		const select = screen.getByRole("combobox", { name: "Resume language" });
		expect(select).toHaveProperty("value", "x-synthetic");
		expect(within(select).getByRole("option", { name: "Current (x-synthetic)" })).toBeTruthy();
		expect(optionValues(select).slice(1)).toEqual([...supportedLocales]);
	});
});
