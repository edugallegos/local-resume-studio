// @vitest-environment happy-dom
import type { ResumeListItem, StoredResume } from "@local-resume/store/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { type ResumeApiClient, ResumeApiError } from "./api/client";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (name = "Ada Lovelace"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = name;
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic summary used by app tests.</p>";
	return data;
};

const listItem = (overrides: Partial<ResumeListItem> = {}): ResumeListItem => ({
	id: "ada-lovelace",
	label: "ada-lovelace",
	fullName: "Ada Lovelace",
	updatedAt: "2026-01-02T03:04:05.000Z",
	...overrides,
});

const storedResume = (item = listItem(), data = syntheticResume(), etag = "etag-1"): StoredResume => ({
	...item,
	data,
	etag,
});

const makeClient = (overrides: Partial<ResumeApiClient> = {}): ResumeApiClient => ({
	list: vi.fn(async () => []),
	read: vi.fn(async () => storedResume()),
	create: vi.fn(async () => storedResume()),
	save: vi.fn(async () => storedResume()),
	duplicate: vi.fn(async () => storedResume()),
	rename: vi.fn(async () => storedResume()),
	remove: vi.fn(async () => undefined),
	exportPdf: vi.fn(async () => ({ filename: "ada-lovelace.pdf" })),
	...overrides,
});

const neverRenderPdf = vi.fn(() => new Promise<never>(() => undefined));

const openResume = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
	await user.click(await screen.findByRole("button", { name: /open ada lovelace/i }));
	await screen.findByLabelText("Full name");
};

afterEach(() => {
	cleanup();
});

describe("App editor tabs", () => {
	it("points every tab control at an existing panel and switches the visible panel", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const client = makeClient({ list: vi.fn(async () => [item]) });

		render(<App client={client} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const tabs = screen.getAllByRole("tab");
		expect(tabs).toHaveLength(3);

		for (const tab of tabs) {
			const panelId = tab.getAttribute("aria-controls");
			expect(panelId).toBeTruthy();
			const panel = document.getElementById(String(panelId));
			expect(panel).not.toBeNull();
			expect(panel?.getAttribute("role")).toBe("tabpanel");
			expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
		}

		const writePanel = document.getElementById("editor-panel-write");
		const designPanel = document.getElementById("editor-panel-design");
		const checkPanel = document.getElementById("editor-panel-check");
		expect(writePanel?.hidden).toBe(false);
		expect(designPanel?.hidden).toBe(true);
		expect(checkPanel?.hidden).toBe(true);

		await user.click(screen.getByRole("tab", { name: /design/i }));
		expect(writePanel?.hidden).toBe(true);
		expect(designPanel?.hidden).toBe(false);
		expect(screen.getByRole("heading", { name: "Design" })).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: /check/i }));
		expect(designPanel?.hidden).toBe(true);
		expect(checkPanel?.hidden).toBe(false);
		expect(screen.getByRole("heading", { name: "Check" })).toBeTruthy();
	});
});

describe("App save workflow", () => {
	it("saves the exact in-memory draft, clears dirty state, and advances the ETag", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const stored = storedResume(item);
		const save = vi.fn<ResumeApiClient["save"]>(async (_id, data) => ({
			...stored,
			data,
			etag: "etag-2",
			updatedAt: "2026-02-03T04:05:06.000Z",
		}));
		const client = makeClient({ list: vi.fn(async () => [item]), read: vi.fn(async () => stored), save });

		render(<App client={client} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const name = screen.getByLabelText("Full name");
		await user.clear(name);
		await user.type(name, "Ada Saved");

		const saveButton = screen.getByRole("button", { name: /save changes/i });
		expect(saveButton).toHaveProperty("disabled", false);
		await user.click(saveButton);

		await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		const [id, data, etag] = save.mock.calls[0] ?? [];
		expect(id).toBe(item.id);
		expect(etag).toBe("etag-1");
		expect(data.basics.name).toBe("Ada Saved");

		await waitFor(() => expect(saveButton).toHaveProperty("disabled", true));
		expect(name).toHaveProperty("value", "Ada Saved");
		expect(screen.getByText("Saved")).toBeTruthy();
	});

	it("keeps Save unavailable through in-flight edits and preserves the newer draft when the save resolves", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const stored = storedResume(item);
		let resolveFirst: (resume: StoredResume) => void = () => undefined;
		const firstSave = new Promise<StoredResume>((resolve) => {
			resolveFirst = resolve;
		});
		const save = vi
			.fn<ResumeApiClient["save"]>()
			.mockImplementationOnce(async () => firstSave)
			.mockImplementationOnce(async (_id, data) => ({
				...stored,
				data,
				etag: "etag-3",
				updatedAt: "2026-03-04T05:06:07.000Z",
			}));
		const client = makeClient({ list: vi.fn(async () => [item]), read: vi.fn(async () => stored), save });

		render(<App client={client} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const name = screen.getByLabelText("Full name");
		await user.clear(name);
		await user.type(name, "Ada Submitted");

		const saveButton = screen.getByRole("button", { name: /save changes/i });
		await user.click(saveButton);
		await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		const [, submitted] = save.mock.calls[0] ?? [];
		expect(submitted?.basics.name).toBe("Ada Submitted");

		// The field remains editable, but Save must not race the in-flight request.
		expect(saveButton).toHaveProperty("disabled", true);
		await user.clear(name);
		await user.type(name, "Ada Newer");
		expect(name).toHaveProperty("value", "Ada Newer");
		expect(saveButton).toHaveProperty("disabled", true);
		expect(screen.getByText("Saving…")).toBeTruthy();
		expect(save).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveFirst({ ...stored, data: submitted ?? stored.data, etag: "etag-2" });
		});

		await waitFor(() => expect(saveButton).toHaveProperty("disabled", false));
		expect(name).toHaveProperty("value", "Ada Newer");
		expect(screen.getByText("Unsaved changes")).toBeTruthy();

		await user.click(saveButton);
		await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
		const [, newerData, nextEtag] = save.mock.calls[1] ?? [];
		expect(nextEtag).toBe("etag-2");
		expect(newerData?.basics.name).toBe("Ada Newer");
		await waitFor(() => expect(saveButton).toHaveProperty("disabled", true));
	});

	it("keeps the exact draft and ETag after a 409 conflict and does not silently retry", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const stored = storedResume(item);
		const save = vi.fn<ResumeApiClient["save"]>(async () => {
			throw new ResumeApiError("The resume changed on disk since it was read.", 409, "CONFLICT");
		});
		const client = makeClient({ list: vi.fn(async () => [item]), read: vi.fn(async () => stored), save });

		render(<App client={client} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const name = screen.getByLabelText("Full name");
		await user.clear(name);
		await user.type(name, "Ada Conflict");

		const saveButton = screen.getByRole("button", { name: /save changes/i });
		await user.click(saveButton);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/changed on disk/i);
		expect(alert.textContent).toMatch(/unsaved draft/i);
		expect(name).toHaveProperty("value", "Ada Conflict");
		expect(saveButton).toHaveProperty("disabled", false);
		expect(screen.getByText("Save conflict")).toBeTruthy();
		expect(save).toHaveBeenCalledTimes(1);

		await user.click(saveButton);
		await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
		expect(save.mock.calls[0]?.[2]).toBe("etag-1");
		expect(save.mock.calls[1]?.[2]).toBe("etag-1");
		expect(name).toHaveProperty("value", "Ada Conflict");
	});

	it("keeps the exact draft and dirty state after any other save failure", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const stored = storedResume(item);
		const save = vi.fn<ResumeApiClient["save"]>(async () => {
			throw new Error("Disk is full.");
		});
		const client = makeClient({ list: vi.fn(async () => [item]), read: vi.fn(async () => stored), save });

		render(<App client={client} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const headline = screen.getByLabelText("Headline");
		await user.clear(headline);
		await user.type(headline, "Ada Unwritten");

		const saveButton = screen.getByRole("button", { name: /save changes/i });
		await user.click(saveButton);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Disk is full.");
		expect(alert.textContent).toMatch(/draft is still here/i);
		expect(headline).toHaveProperty("value", "Ada Unwritten");
		expect(saveButton).toHaveProperty("disabled", false);
		expect(screen.getByText("Save failed")).toBeTruthy();
	});
});

describe("App dirty draft navigation", () => {
	it("exports the active dirty draft from the library without re-reading the stored file", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const stored = storedResume(item);
		const read = vi.fn<ResumeApiClient["read"]>(async () => stored);
		const client = makeClient({ list: vi.fn(async () => [item]), read });
		const downloadJson = vi.fn();

		render(<App client={client} downloadJson={downloadJson} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const name = screen.getByLabelText("Full name");
		await user.clear(name);
		await user.type(name, "Ada Draft Export");

		await user.click(screen.getByRole("button", { name: /library/i }));
		await user.click(await screen.findByRole("button", { name: /export selected json/i }));

		await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
		const [filename, contents] = vi.mocked(downloadJson).mock.calls[0] ?? [];
		expect(filename).toBe("ada-lovelace.json");
		expect(JSON.parse(contents).basics.name).toBe("Ada Draft Export");
		expect(JSON.parse(contents)).not.toHaveProperty("resume");
		expect(contents.trimStart().startsWith("{")).toBe(true);
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("blocks opening another file from the library and returns to the editor with the draft intact", async () => {
		const user = userEvent.setup();
		const active = listItem();
		const other = listItem({ id: "grace-hopper", label: "grace-hopper", fullName: "Grace Hopper" });
		const stored = storedResume(active);
		const read = vi.fn<ResumeApiClient["read"]>(async () => stored);
		const client = makeClient({ list: vi.fn(async () => [active, other]), read });

		render(<App client={client} renderPdf={neverRenderPdf} />);
		await openResume(user);

		const name = screen.getByLabelText("Full name");
		await user.clear(name);
		await user.type(name, "Ada Draft Kept");

		await user.click(screen.getByRole("button", { name: /library/i }));
		await screen.findByRole("button", { name: /open grace hopper/i });
		await user.click(screen.getByRole("button", { name: /open grace hopper/i }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/return to the editor and save first/i);
		expect(read).toHaveBeenCalledTimes(1);
		expect(screen.queryByLabelText("Full name")).toBeNull();

		await user.click(screen.getByRole("button", { name: /return to editor/i }));
		expect(await screen.findByLabelText("Full name")).toHaveProperty("value", "Ada Draft Kept");
		expect(read).toHaveBeenCalledTimes(1);
	});
});

describe("App PDF export", () => {
	it("archives and downloads the exact Blob the preview rendered, without saving the draft", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const stored = storedResume(item);
		const pdfBlob = new Blob(["%PDF-1.7 preview"], { type: "application/pdf" });
		const exportPdf = vi.fn(async () => ({ filename: "ada-lovelace-2026.pdf" }));
		const save = vi.fn<ResumeApiClient["save"]>(async () => stored);
		const savePdf = vi.fn();
		const client = makeClient({ list: vi.fn(async () => [item]), read: vi.fn(async () => stored), exportPdf, save });
		const renderPdf = vi.fn(async () => ({
			blob: pdfBlob,
			pageMap: { pages: [{ width: 595, height: 842 }], nodes: [] },
			missingFonts: [],
			lostCharacters: [],
		}));

		render(
			<App
				client={client}
				renderPdf={renderPdf}
				loadPdfDocument={async () => ({
					numPages: 1,
					getPage: async () => ({
						getViewport: () => ({ width: 595, height: 842 }),
						render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
					}),
				})}
				savePdf={savePdf}
			/>,
		);
		await openResume(user);

		const download = await screen.findByRole("button", { name: /download pdf/i });
		await waitFor(() => expect(download).toHaveProperty("disabled", false));
		await user.click(download);

		await waitFor(() => expect(exportPdf).toHaveBeenCalledTimes(1));
		expect(exportPdf).toHaveBeenCalledWith(item.id, pdfBlob);
		await waitFor(() => expect(savePdf).toHaveBeenCalledWith("ada-lovelace-2026.pdf", pdfBlob));
		expect(save).not.toHaveBeenCalled();
		expect(screen.getByRole("status").textContent).toMatch(/Archived in the local PDF store/i);
	});
});
