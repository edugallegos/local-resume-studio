import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const fixturePath = fileURLToPath(new URL("./fixtures/resume-v6.1.0.json", import.meta.url));
const dataDir = process.env.E2E_DATA_DIR;
if (!dataDir) throw new Error("E2E_DATA_DIR is required; run the tests through pnpm e2e.");
const resumesDir = join(dataDir, "resumes");
const exportsDir = join(dataDir, "exports");

const openLibrary = async (page: Page): Promise<void> => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: /Your resumes, on this desk/i })).toBeVisible();
};

const resumeId = (label: string): string =>
	label
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const createResume = async (page: Page, label: string): Promise<void> => {
	await openLibrary(page);
	await page.getByRole("button", { name: "New resume" }).click();
	await page.getByLabel("Resume label").fill(label);
	await page.getByRole("button", { name: "Create resume" }).click();
	await page.getByRole("button", { name: `Open ${resumeId(label)}` }).click();
	await expect(page.getByLabel("Full name")).toBeVisible();
};

const saveDraft = async (page: Page): Promise<void> => {
	const save = page.getByRole("button", { name: "Save changes" });
	await expect(save).toBeEnabled();
	await save.click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
};

const archivedPdfs = async (): Promise<string[]> => {
	try {
		return (await readdir(exportsDir)).filter((name) => name.endsWith(".pdf"));
	} catch {
		return [];
	}
};

test.describe("local editor round trips", () => {
	test("imports v6.1.0 JSON, saves an edit, reloads, and preserves an unsupported extension", async ({
		page,
	}) => {
		await openLibrary(page);
		await page.getByLabel("Import resume JSON").setInputFiles(fixturePath);

		const open = page.getByRole("button", { name: "Open Ada Lovelace (Synthetic)" });
		await expect(open).toBeVisible();
		await open.click();

		const fullName = page.getByLabel("Full name");
		await expect(fullName).toHaveValue("Ada Lovelace (Synthetic)");
		await fullName.fill("Ada Lovelace (Edited)");
		await saveDraft(page);

		await page.reload();
		await page.getByRole("button", { name: "Open Ada Lovelace (Edited)" }).click();
		await expect(page.getByLabel("Full name")).toHaveValue("Ada Lovelace (Edited)");

		const stored = JSON.parse(await readFile(join(resumesDir, "resume-v6-1-0.json"), "utf8")) as {
			basics: { name: string };
			"x-synthetic-extension": unknown;
		};
		expect(stored.basics.name).toBe("Ada Lovelace (Edited)");
		expect(stored["x-synthetic-extension"]).toEqual({
			purpose: "e2e-preservation-check",
			nested: { value: "keep-me" },
		});
	});

	test("previews a gallery template without changing the draft, applies it, and downloads an archived PDF", async ({
		page,
	}) => {
		await createResume(page, "Template Export");
		await page.getByLabel("Full name").fill("Template Export");
		await saveDraft(page);
		await page.getByRole("tab", { name: "Design" }).click();

		const gallery = page.getByRole("group", { name: "Template gallery" });
		await expect(gallery.getByRole("button")).toHaveCount(18);
		const appliedCard = gallery.locator('[aria-pressed="true"]');
		await expect(appliedCard).toHaveAttribute("data-template-id", "onyx");

		const save = page.getByRole("button", { name: "Save changes" });
		await expect(save).toBeDisabled();

		// Hovering is a temporary preview: the selected draft and Save state stay untouched.
		const azurill = gallery.locator('[data-template-id="azurill"]');
		await azurill.hover();
		await expect(page.getByTestId("template-preview-status")).toContainText(
			"Previewing Azurill · click to apply",
		);
		await expect(appliedCard).toHaveAttribute("data-template-id", "onyx");
		await expect(save).toBeDisabled();

		// Only the click applies the template to the in-memory draft.
		await azurill.click();
		await expect(azurill).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByTestId("template-preview-status")).toHaveCount(0);
		await expect(save).toBeEnabled();

		const downloadButton = page.getByRole("button", { name: "Download PDF" });
		await expect(downloadButton).toBeEnabled({ timeout: 90_000 });

		const downloadPromise = page.waitForEvent("download");
		await downloadButton.click();
		const download = await downloadPromise;
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const bytes = await readFile(downloadedPath as string);
		expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
		expect(bytes.length).toBeGreaterThan(100);

		await expect(page.getByRole("status")).toContainText(/Archived in the local PDF store/i);
		await expect.poll(archivedPdfs, { timeout: 20_000 }).not.toHaveLength(0);
		const archived = await archivedPdfs();
		const archivedBytes = await readFile(join(exportsDir, archived[0] as string));
		expect(archivedBytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
		expect(archivedBytes.length).toBeGreaterThan(100);
	});

	test("reviews an ATS issue in Write, edits the real field, saves, and clears the issue", async ({
		page,
	}) => {
		await createResume(page, "Check Issue");
		await page.getByRole("tab", { name: "Check" }).click();

		const missingName = page.locator('[data-issue-code="MISSING_NAME"]');
		await expect(missingName).toBeVisible();
		await missingName.getByRole("button", { name: /Review .* in Write/i }).click();
		await expect(page.getByRole("tab", { name: "Write" })).toHaveAttribute("aria-selected", "true");
		await expect(page.getByLabel("Full name")).toBeFocused();

		await page.getByLabel("Full name").fill("Ada Check");
		await saveDraft(page);
		await page.getByRole("tab", { name: "Check" }).click();
		await expect(page.locator('[data-issue-code="MISSING_NAME"]')).toHaveCount(0);
	});

	test("keeps a draft on conflict, shows disk details, and reloads only on explicit action", async ({
		page,
	}) => {
		await createResume(page, "Conflict Draft");
		const fullName = page.getByLabel("Full name");
		await fullName.fill("Draft Name");

		const filePath = join(resumesDir, "conflict-draft.json");
		const disk = JSON.parse(await readFile(filePath, "utf8")) as {
			basics: { name: string; headline: string };
		};
		disk.basics.name = "Disk Name";
		disk.basics.headline = "Disk headline";
		await writeFile(filePath, `${JSON.stringify(disk, null, 2)}\n`, "utf8");

		let saves = 0;
		page.on("request", (request) => {
			if (
				request.method() === "PUT" &&
				new URL(request.url()).pathname === "/api/resumes/conflict-draft"
			) {
				saves += 1;
			}
		});

		await page.getByRole("button", { name: "Save changes" }).click();
		const conflict = page.getByRole("alert").filter({ hasText: /changed on disk/i });
		await expect(conflict).toBeVisible();
		await expect(fullName).toHaveValue("Draft Name");
		await expect(conflict).toContainText(/Latest disk version updated/i);
		await expect(page.getByRole("button", { name: "Reload from disk" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Keep editing" })).toBeVisible();
		expect(saves).toBe(1);

		await page.waitForTimeout(400);
		expect(saves).toBe(1);

		await page.getByRole("button", { name: "Keep editing" }).click();
		await expect(conflict).toHaveCount(0);
		await expect(fullName).toHaveValue("Draft Name");
		expect(saves).toBe(1);
		expect((JSON.parse(await readFile(filePath, "utf8")) as typeof disk).basics.name).toBe("Disk Name");

		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(conflict).toBeVisible();
		expect(saves).toBe(2);

		await page.getByRole("button", { name: "Reload from disk" }).click();
		await expect(fullName).toHaveValue("Disk Name");
		await expect(conflict).toHaveCount(0);
		expect(saves).toBe(2);
	});
});
