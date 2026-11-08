import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 20_000 },
	reporter: [["list"]],
	outputDir: process.env.E2E_OUTPUT_DIR ?? "test-results",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
		headless: true,
		acceptDownloads: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
});
