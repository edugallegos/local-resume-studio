import { describe, expect, it } from "vitest";
import { pnpmStartCommand } from "./e2e-processes.mjs";

describe("pnpmStartCommand", () => {
	it("uses cmd.exe with fixed arguments for pnpm start on Windows", () => {
		expect(pnpmStartCommand({ platform: "win32", comSpec: "C:\\Windows\\System32\\cmd.exe" })).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", "pnpm start"],
		});
	});

	it("falls back to cmd.exe when ComSpec is unavailable", () => {
		expect(pnpmStartCommand({ platform: "win32", comSpec: "" })).toEqual({
			command: "cmd.exe",
			args: ["/d", "/s", "/c", "pnpm start"],
		});
	});

	it.each(["darwin", "linux"] as const)("uses pnpm start directly on %s", (platform) => {
		expect(pnpmStartCommand({ platform })).toEqual({
			command: "pnpm",
			args: ["start"],
		});
	});
});
