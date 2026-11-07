// @vitest-environment happy-dom
import type { ResumeListItem, StoredResume } from "@local-resume/store/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ResumeApiClient, ResumeApiError } from "../../api/client";
import { ResumeLibrary } from "./resume-library";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (name = "Ada Lovelace"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = name;
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic summary used by library tests.</p>";
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
	...overrides,
});

const renderLibrary = (client: ResumeApiClient, props: Partial<Parameters<typeof ResumeLibrary>[0]> = {}) =>
	render(<ResumeLibrary client={client} onOpen={vi.fn()} {...props} />);

afterEach(() => {
	cleanup();
});

describe("ResumeLibrary", () => {
	it("shows loading first, then labels, full names, and updated times", async () => {
		const item = listItem();
		const client = makeClient({ list: vi.fn(async () => [item]) });

		const { container } = renderLibrary(client);

		expect(screen.getByRole("status").textContent).toContain("Loading resumes");
		expect(await screen.findByRole("button", { name: /open ada lovelace/i })).toBeTruthy();
		expect(screen.getByText("ada-lovelace")).toBeTruthy();
		expect(screen.getByRole("button", { name: /export selected json/i })).toHaveProperty("disabled", true);

		const time = container.querySelector("time");
		expect(time?.getAttribute("datetime")).toBe(item.updatedAt);
	});

	it("shows an empty state when the local data directory has no resumes", async () => {
		renderLibrary(makeClient({ list: vi.fn(async () => []) }));

		expect(await screen.findByText(/no resumes yet/i)).toBeTruthy();
	});

	it("shows a typed API error in the view", async () => {
		const client = makeClient({
			list: vi.fn(async () => {
				throw new ResumeApiError("The local server could not read the resume library.", 500, "INTERNAL_ERROR");
			}),
		});

		renderLibrary(client);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("The local server could not read the resume library.");
	});

	it("opens a resume through the injected client", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const resume = storedResume(item);
		const client = makeClient({ list: vi.fn(async () => [item]), read: vi.fn(async () => resume) });
		const onOpen = vi.fn();

		renderLibrary(client, { onOpen });

		await user.click(await screen.findByRole("button", { name: /open ada lovelace/i }));

		expect(client.read).toHaveBeenCalledWith(item.id);
		expect(onOpen).toHaveBeenCalledWith(resume);
	});

	it("creates a blank synthetic resume from the library form", async () => {
		const user = userEvent.setup();
		let resumes: ResumeListItem[] = [];
		const createdItem = listItem({
			id: "synthetic-resume",
			label: "synthetic-resume",
			fullName: "Synthetic Person",
		});
		const createdData = syntheticResume("Synthetic Person");
		const created = storedResume(createdItem, createdData);
		const client = makeClient({
			list: vi.fn(async () => resumes),
			create: vi.fn(async () => {
				resumes = [createdItem];
				return created;
			}),
		});
		const onCreated = vi.fn();

		renderLibrary(client, { onCreated });

		await screen.findByText(/no resumes yet/i);
		await user.click(screen.getByRole("button", { name: /new resume/i }));
		await user.type(screen.getByLabelText(/resume label/i), "Synthetic Resume");
		await user.click(screen.getByRole("button", { name: /create resume/i }));

		expect(client.create).toHaveBeenCalledTimes(1);
		const [label, data] = vi.mocked(client.create).mock.calls[0] ?? [];
		expect(label).toBe("Synthetic Resume");
		expect(data).toEqual(defaultResumeData);
		expect(onCreated).toHaveBeenCalledWith(created);
		expect(await screen.findByText("Synthetic Person")).toBeTruthy();
	});

	it("duplicates a resume with a suggested label", async () => {
		const user = userEvent.setup();
		const item = listItem();
		let resumes: ResumeListItem[] = [item];
		const copyItem = listItem({ id: "ada-lovelace-copy", label: "ada-lovelace-copy" });
		const copy = storedResume(copyItem, syntheticResume());
		const client = makeClient({
			list: vi.fn(async () => resumes),
			duplicate: vi.fn(async () => {
				resumes = [item, copyItem];
				return copy;
			}),
		});
		const onDuplicated = vi.fn();

		renderLibrary(client, { onDuplicated });

		await user.click(await screen.findByRole("button", { name: /duplicate ada lovelace/i }));
		const input = screen.getByLabelText(/resume label/i);
		expect(input).toHaveProperty("value", "ada-lovelace copy");

		await user.clear(input);
		await user.type(input, "Ada Lovelace Copy");
		await user.click(screen.getByRole("button", { name: /duplicate resume/i }));

		expect(client.duplicate).toHaveBeenCalledWith(item.id, "Ada Lovelace Copy");
		expect(onDuplicated).toHaveBeenCalledWith(copy);
		expect(await screen.findByText("ada-lovelace-copy")).toBeTruthy();
	});

	it("renames a resume using the current ETag", async () => {
		const user = userEvent.setup();
		const item = listItem();
		let resumes: ResumeListItem[] = [item];
		const read = storedResume(item, syntheticResume(), "etag-read");
		const renamedItem = listItem({ id: "ada-lovelace-updated", label: "ada-lovelace-updated" });
		const renamed = storedResume(renamedItem, syntheticResume(), "etag-read");
		const client = makeClient({
			list: vi.fn(async () => resumes),
			read: vi.fn(async () => read),
			rename: vi.fn(async () => {
				resumes = [renamedItem];
				return renamed;
			}),
		});
		const onRenamed = vi.fn();

		renderLibrary(client, { onRenamed });

		await user.click(await screen.findByRole("button", { name: /rename ada lovelace/i }));
		const input = screen.getByLabelText(/resume label/i);
		expect(input).toHaveProperty("value", "ada-lovelace");

		await user.clear(input);
		await user.type(input, "Ada Lovelace Updated");
		await user.click(screen.getByRole("button", { name: /rename resume/i }));

		expect(client.read).toHaveBeenCalledWith(item.id);
		expect(client.rename).toHaveBeenCalledWith(item.id, "Ada Lovelace Updated", "etag-read");
		expect(onRenamed).toHaveBeenCalledWith(renamed, item.id);
		expect(await screen.findByText("ada-lovelace-updated")).toBeTruthy();
	});

	it("asks for confirmation before deleting and refreshes the list", async () => {
		const user = userEvent.setup();
		const item = listItem();
		let resumes: ResumeListItem[] = [item];
		const client = makeClient({
			list: vi.fn(async () => resumes),
			read: vi.fn(async () => storedResume(item, syntheticResume(), "etag-delete")),
			remove: vi.fn(async () => {
				resumes = [];
			}),
		});
		const confirmDelete = vi.fn(() => true);
		const onDeleted = vi.fn();

		renderLibrary(client, { confirmDelete, onDeleted });

		await user.click(await screen.findByRole("button", { name: /delete ada lovelace/i }));

		expect(confirmDelete).toHaveBeenCalledWith(item);
		await waitFor(() => expect(client.remove).toHaveBeenCalledWith(item.id, "etag-delete"));
		expect(onDeleted).toHaveBeenCalledWith(item.id);
		expect(await screen.findByText(/no resumes yet/i)).toBeTruthy();
	});

	it("does not delete when confirmation is declined", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const client = makeClient({ list: vi.fn(async () => [item]) });
		const confirmDelete = vi.fn(() => false);

		renderLibrary(client, { confirmDelete });

		await user.click(await screen.findByRole("button", { name: /delete ada lovelace/i }));

		expect(confirmDelete).toHaveBeenCalledWith(item);
		expect(client.read).not.toHaveBeenCalled();
		expect(client.remove).not.toHaveBeenCalled();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
	});

	it("imports a standard Reactive Resume JSON file without an app wrapper", async () => {
		const data = syntheticResume("Grace Hopper");
		let resumes: ResumeListItem[] = [];
		const importedItem = listItem({
			id: "synthetic-resume",
			label: "synthetic-resume",
			fullName: "Grace Hopper",
		});
		const imported = storedResume(importedItem, data);
		const client = makeClient({
			list: vi.fn(async () => resumes),
			create: vi.fn(async () => {
				resumes = [importedItem];
				return imported;
			}),
		});
		const onImported = vi.fn();

		renderLibrary(client, { onImported });

		await screen.findByText(/no resumes yet/i);
		const input = screen.getByLabelText(/import resume json/i);
		const file = new File([JSON.stringify(data)], "synthetic-resume.json", { type: "application/json" });

		fireEvent.change(input, { target: { files: [file] } });

		await waitFor(() => expect(client.create).toHaveBeenCalledWith("synthetic-resume", data));
		expect(onImported).toHaveBeenCalledWith(imported);
		expect(await screen.findByText("Grace Hopper")).toBeTruthy();
	});

	it("exports the selected raw resume JSON with no app-specific wrapper", async () => {
		const user = userEvent.setup();
		const item = listItem();
		const data = syntheticResume("Ada Exportable");
		const client = makeClient({
			list: vi.fn(async () => [item]),
			read: vi.fn(async () => storedResume(item, data)),
		});
		const downloadJson = vi.fn();

		renderLibrary(client, { selectedId: item.id, downloadJson });

		await screen.findByText(item.fullName);
		await user.click(screen.getByRole("button", { name: /export selected json/i }));

		await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
		const [filename, contents] = vi.mocked(downloadJson).mock.calls[0] ?? [];
		expect(filename).toBe("ada-lovelace.json");
		expect(JSON.parse(contents)).toEqual(data);
		expect(contents.trimStart().startsWith("{")).toBe(true);
		expect(JSON.parse(contents)).not.toHaveProperty("resume");
	});
});
