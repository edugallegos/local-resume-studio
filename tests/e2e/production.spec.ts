import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { expect, test } from "@playwright/test";

const dataDir = process.env.E2E_DATA_DIR;
const baseURL = process.env.E2E_BASE_URL;
if (!dataDir) throw new Error("E2E_DATA_DIR is required; run through pnpm e2e:production.");
if (!baseURL) throw new Error("E2E_BASE_URL is required; run through pnpm e2e:production.");

const exportsDir = join(dataDir, "exports");
const fontFixturePath = fileURLToPath(new URL("../fixtures/TestSerif.woff", import.meta.url));
const sentinel = `PRODUCTION-SENTINEL-${randomUUID()}`;

const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.metadata.template = "onyx";
	data.basics.name = `Production Smoke ${sentinel}`;
	data.basics.headline = `${sentinel} Synthetic Release Verification`;
	data.basics.email = `${sentinel}@example.test`;
	data.basics.phone = "+1 555 0100";
	data.basics.location = "Loopback City";
	data.basics.website = { url: "https://example.test", label: "example.test" };
	data.summary.title = "Summary";
	data.summary.content = `<p>${sentinel} summary for production verification.</p>`;
	data.sections.experience.title = "Experience";
	data.sections.experience.items = [
		{
			id: "production-smoke-experience",
			hidden: false,
			company: "Production Smoke Works",
			position: "Programmer",
			location: "Loopback City",
			period: "2020 - 2022",
			dates: { start: "2020", end: "2022", present: false },
			website: { url: "", label: "", inlineLink: false },
			description: `<p>${sentinel} delivered a synthetic verification result.</p>`,
			roles: [],
		},
	];
	return data;
};

const archivedPdfs = async (): Promise<string[]> => {
	try {
		return (await readdir(exportsDir)).filter((name) => name.endsWith(".pdf"));
	} catch {
		return [];
	}
};

type CapturedRequest = {
	url: string;
	body: string | null;
	headers: Record<string, string>;
};

test("production build serves the app, round-trips JSON, exports a PDF, and analyzes it locally", async ({
	page,
}) => {
	const fontBytes = await readFile(fontFixturePath);
	await page.route(/https:\/\/fonts\.gstatic\.(?:com|cn)\/.*/, async (route) => {
		await route.fulfill({ status: 200, contentType: "font/woff", body: fontBytes });
	});

	const requests: CapturedRequest[] = [];
	page.on("request", (request) => {
		requests.push({
			url: request.url(),
			body: request.postData(),
			headers: request.headers(),
		});
	});

	await page.goto("/");
	expect(page.url().startsWith(baseURL)).toBe(true);
	await expect(page.getByRole("heading", { name: /Your resumes, on this desk/i })).toBeVisible();

	const health = await page.request.get(`${baseURL}/api/health`);
	expect(health.ok()).toBe(true);
	expect(await health.json()).toEqual({ status: "ok" });

	const data = syntheticResume();
	const created = (await page.evaluate(
		async ({ label, data }) => {
			const response = await fetch("/api/resumes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ label, data }),
			});
			return { status: response.status, body: await response.json() };
		},
		{ label: "Production Smoke", data },
	)) as { status: number; body: { id: string; etag: string } };
	expect(created.status).toBe(201);
	const id = created.body.id;
	const etag = created.body.etag;

	const read = (await page.evaluate(async (id) => {
		const response = await fetch(`/api/resumes/${id}`);
		return { status: response.status, body: await response.json() };
	}, id)) as { status: number; body: { resume: { data: ResumeData } } };
	expect(read.status).toBe(200);
	expect(read.body.resume.data.summary.content).toContain(sentinel);

	const savedName = `Production Smoke Saved ${sentinel}`;
	data.basics.name = savedName;
	data.basics.headline = `${sentinel} Saved Headline`;
	data.summary.content = `<p>${sentinel} saved through the production API.</p>`;
	const saved = (await page.evaluate(
		async ({ id, data, etag }) => {
			const response = await fetch(`/api/resumes/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json", "If-Match": etag },
				body: JSON.stringify(data),
			});
			return { status: response.status, body: await response.json() };
		},
		{ id, data, etag },
	)) as { status: number; body: { data: ResumeData } };
	expect(saved.status).toBe(200);
	expect(saved.body.data.basics.name).toBe(savedName);
	expect(saved.body.data.summary.content).toContain(sentinel);

	await page.goto("/");
	await page.getByRole("button", { name: `Open ${savedName}` }).click();
	await expect(page.getByLabel("Full name")).toHaveValue(savedName);

	const downloadButton = page.getByRole("button", { name: "Download PDF" });
	await expect(downloadButton).toBeEnabled({ timeout: 90_000 });
	const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
	const downloadedPath = await download.path();
	expect(downloadedPath).not.toBeNull();
	const downloadedBytes = await readFile(downloadedPath as string);
	expect(downloadedBytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
	expect(downloadedBytes.length).toBeGreaterThan(100);

	await expect(page.getByRole("status")).toContainText(/Archived in the local PDF store/i);
	await expect.poll(archivedPdfs, { timeout: 20_000 }).not.toHaveLength(0);
	const archived = await archivedPdfs();
	const archivedBytes = await readFile(join(exportsDir, archived[0] as string));
	expect(archivedBytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
	expect(archivedBytes.length).toBeGreaterThan(100);

	await page.getByRole("tab", { name: "Check" }).click();
	await expect(page.getByTestId("ats-score")).toBeVisible();
	const analyze = page.getByRole("button", { name: "Analyze generated PDF" });
	await expect(analyze).toBeEnabled();
	await analyze.click();
	await expect(page.getByText(/PDF score \d+ \/ 100/)).toBeVisible({ timeout: 90_000 });

	const loopbackHost = new URL(baseURL).hostname;
	expect(requests.some((request) => (request.body ?? "").includes(sentinel))).toBe(true);

	for (const request of requests) {
		const serialized = `${request.url}\n${request.body ?? ""}\n${JSON.stringify(request.headers)}`;
		if (!serialized.includes(sentinel)) continue;
		expect(new URL(request.url).hostname).toBe(loopbackHost);
	}

	const fontRequests = requests.filter(
		(request) =>
			/\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(request.url) ||
			/fonts\.(?:gstatic|googleapis)|jsdelivr/i.test(request.url),
	);
	expect(fontRequests.length).toBeGreaterThan(0);
	for (const request of fontRequests) {
		const serialized = `${request.url}\n${request.body ?? ""}\n${JSON.stringify(request.headers)}`;
		expect(serialized).not.toContain(sentinel);
	}
});
