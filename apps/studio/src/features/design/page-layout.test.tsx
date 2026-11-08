// @vitest-environment happy-dom
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editResume, type ResumeEdit } from "../write/resume-edits";
import { PageLayout } from "./page-layout";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
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
		<PageLayout
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
	const onEdit = vi.fn<(edit: ResumeEdit) => void>();
	const onData = vi.fn<(data: ResumeData) => void>();
	const user = userEvent.setup();
	render(<Harness initialData={data} onEdit={onEdit} onData={onData} />);
	const latest = (): ResumeData => onData.mock.calls.at(-1)?.[0] ?? data;
	return { user, onEdit, onData, latest };
};

const twoPages = (): ResumeData => {
	const data = syntheticResume();
	data.metadata.layout.pages.push({ fullWidth: false, main: [], sidebar: [] });
	return data;
};

const sectionIdsAcrossPages = (data: ResumeData): string[] =>
	data.metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]);

afterEach(() => {
	cleanup();
});

describe("PageLayout", () => {
	it("adds a page and prevents removing the final page", async () => {
		const { user, latest } = setup();
		expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(1);

		await user.click(screen.getByRole("button", { name: "Add page" }));
		expect(latest().metadata.layout.pages).toHaveLength(2);
		expect(screen.getByRole("heading", { name: "Page 2" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Remove page 2" }));
		expect(latest().metadata.layout.pages).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Remove page 1" })).toBeNull();
	});

	it("reorders and transfers sections within a page", async () => {
		const { user, latest } = setup();
		const page = () => latest().metadata.layout.pages[0];

		expect(page()?.main.slice(0, 2)).toEqual(["summary", "experience"]);
		await user.click(screen.getByRole("button", { name: "Move Experience up" }));
		expect(page()?.main.slice(0, 2)).toEqual(["experience", "summary"]);

		await user.click(screen.getByRole("button", { name: "Move Skills to main" }));
		expect(page()?.sidebar).not.toContain("skills");
		expect(page()?.main).toContain("skills");
	});

	it("moves a section to another page and column with a labelled page selector", async () => {
		const { user, latest } = setup(twoPages());
		const firstPage = () => latest().metadata.layout.pages[0];
		const secondPage = () => latest().metadata.layout.pages[1];

		await user.selectOptions(screen.getByLabelText("Move Experience page"), "1:sidebar");

		expect(firstPage()?.main).not.toContain("experience");
		expect(secondPage()?.sidebar).toEqual(["experience"]);
		const ids = sectionIdsAcrossPages(latest());
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("moves sidebar sections into main for a full-width page and keeps them there when turned off", async () => {
		const { user, latest } = setup();
		const sidebar = [...(latest().metadata.layout.pages[0]?.sidebar ?? [])];
		const fullWidth = screen.getByRole("checkbox", { name: "Full width for page 1" });

		await user.click(fullWidth);
		expect(latest().metadata.layout.pages[0]?.fullWidth).toBe(true);
		expect(latest().metadata.layout.pages[0]?.sidebar).toEqual([]);
		for (const id of sidebar) expect(latest().metadata.layout.pages[0]?.main).toContain(id);

		await user.click(screen.getByRole("checkbox", { name: "Full width for page 1" }));
		expect(latest().metadata.layout.pages[0]?.fullWidth).toBe(false);
		expect(latest().metadata.layout.pages[0]?.sidebar).toEqual([]);
		for (const id of sidebar) expect(latest().metadata.layout.pages[0]?.main).toContain(id);
	});

	it("moves a deleted page's sections onto the surviving page exactly once", async () => {
		const { user, latest } = setup(twoPages());

		await user.selectOptions(screen.getByLabelText("Move Experience page"), "1:main");
		await user.click(screen.getByRole("button", { name: "Remove page 2" }));

		const ids = sectionIdsAcrossPages(latest());
		expect(ids.filter((id) => id === "experience")).toHaveLength(1);
		expect(new Set(ids).size).toBe(ids.length);
		expect(latest().metadata.layout.pages[0]?.main).toContain("experience");
	});

	it("shows sidebar side and width only for two-column templates and writes them", async () => {
		const oneColumn = syntheticResume();
		setup(oneColumn);
		expect(screen.queryByLabelText("Sidebar side")).toBeNull();
		expect(screen.queryByLabelText("Sidebar width")).toBeNull();
		cleanup();

		const twoColumn = syntheticResume();
		twoColumn.metadata.template = "azurill";
		const { user, latest } = setup(twoColumn);
		const side = screen.getByLabelText("Sidebar side");
		expect(side).toHaveProperty("value", "left");
		await user.selectOptions(side, "right");
		expect(latest().metadata.layout.sidebarSide).toBe("right");

		const width = screen.getByLabelText("Sidebar width");
		await user.clear(width);
		await user.type(width, "42");
		expect(latest().metadata.layout.sidebarWidth).toBe(42);
	});

	it("labels each page column and keeps page metadata when sections move", async () => {
		const data = twoPages() as ResumeData & {
			metadata: ResumeData["metadata"] & { layout: ResumeData["metadata"]["layout"] & { "x-layout"?: unknown } };
		};
		data.metadata.layout["x-layout"] = { keep: true };
		const firstPage = data.metadata.layout.pages[0];
		if (!firstPage) throw new Error("fixture page missing");
		firstPage.main = firstPage.main.filter((id) => id !== "experience");
		data.metadata.layout.pages[1] = {
			fullWidth: false,
			main: ["experience"],
			sidebar: [],
			"x-page-extra": "kept",
		} as never;

		const { user, latest } = setup(data);
		await act(async () => {
			await user.selectOptions(screen.getByLabelText("Move Experience page"), "0:main");
		});

		const page = latest().metadata.layout.pages[1] as unknown as Record<string, unknown>;
		expect(page["x-page-extra"]).toBe("kept");
		expect((latest().metadata.layout as unknown as Record<string, unknown>)["x-layout"]).toEqual({ keep: true });
		expect(latest().metadata.layout.pages[0]?.main).toContain("experience");
	});
});
