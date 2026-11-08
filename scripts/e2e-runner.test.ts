import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type ProcessRow = { pid: number; ppid: number; command: string };

let runner: ChildProcess | null = null;
let privateTempParent: string | null = null;
const ownedPids = new Set<number>();

const sleep = (ms: number) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

const waitFor = async (
	predicate: () => Promise<boolean> | boolean,
	timeoutMs: number,
	message: () => string,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			if (await predicate()) return;
		} catch {
			// Keep polling while the process tree or temp path settles.
		}
		await sleep(100);
	}
	throw new Error(message());
};

const processRows = async (): Promise<ProcessRow[]> => {
	const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,command="]);
	const rows: ProcessRow[] = [];
	for (const line of stdout.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		if (!match) continue;
		rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" });
	}
	return rows;
};

const descendantsOf = (rootPid: number, rows: ProcessRow[]): ProcessRow[] => {
	const descendants: ProcessRow[] = [];
	const queue = [rootPid];
	while (queue.length > 0) {
		const parent = queue.shift() as number;
		for (const row of rows) {
			if (row.ppid !== parent) continue;
			descendants.push(row);
			queue.push(row.pid);
		}
	}
	return descendants;
};

const isAlive = async (pid: number): Promise<boolean> => {
	try {
		const { stdout } = await execFileAsync("ps", ["-o", "stat=", "-p", String(pid)]);
		const state = stdout.trim();
		return state !== "" && !state.startsWith("Z");
	} catch {
		return false;
	}
};

const waitForOutput = (output: () => string, pattern: RegExp, timeoutMs: number): Promise<string> =>
	waitFor(
		() => pattern.test(output()),
		timeoutMs,
		() => `Timed out waiting for ${pattern}.\nRunner output:\n${output()}`,
	).then(() => {
		const match = pattern.exec(output());
		return match?.[1] ?? "";
	});

const cleanup = async (): Promise<void> => {
	if (runner?.pid) {
		// Re-discover descendants in case the test failed before recording the process tree.
		try {
			const rows = await processRows();
			for (const child of descendantsOf(runner.pid, rows)) ownedPids.add(child.pid);
		} catch {
			// Process listing is best effort during teardown.
		}
		try {
			process.kill(runner.pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
	for (const pid of ownedPids) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
	if (privateTempParent) {
		// The runner's own local-resume-e2e-* root lives inside this private parent.
		await rm(privateTempParent, { recursive: true, force: true });
	}
	runner = null;
	privateTempParent = null;
	ownedPids.clear();
};

afterEach(cleanup);

describe("E2E runner interruption", () => {
	// This integration test inspects Unix `ps` output and process groups, so it is skipped on Windows.
	// Windows tree cleanup uses taskkill.exe /T /F through stopWindowsProcessTree and is covered by
	// scripts/e2e-processes.test.ts with injected taskkill spawn behavior.
	it.skipIf(process.platform === "win32")(
		"removes its temp root and runner-owned processes on SIGTERM",
		async () => {
			let output = "";
			privateTempParent = await mkdtemp(join(tmpdir(), "local-resume-e2e-test-"));
			runner = spawn(process.execPath, [join(root, "scripts/e2e.mjs")], {
				cwd: root,
				env: { ...process.env, TMPDIR: privateTempParent },
				stdio: ["ignore", "pipe", "pipe"],
			});
			ownedPids.add(runner.pid as number);
			runner.stdout?.on("data", (chunk: Buffer) => {
				output += chunk.toString();
			});
			runner.stderr?.on("data", (chunk: Buffer) => {
				output += chunk.toString();
			});

			const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
				runner?.once("exit", (code, signal) => resolveExit({ code, signal }));
			});

			const tempRoot = (await waitForOutput(() => output, /Data directory: (.+)/, 30_000)).trim();
			expect(privateTempParent).not.toBeNull();
			expect(tempRoot.startsWith(privateTempParent ?? "")).toBe(true);

			await waitForOutput(() => output, /Running \d+ tests? using 1 worker/, 60_000);
			// Let the Playwright command spawn its browser before recording the process tree.
			await sleep(700);

			const rows = await processRows();
			const descendants = descendantsOf(runner.pid as number, rows);
			expect(descendants.length).toBeGreaterThanOrEqual(2);
			for (const child of descendants) ownedPids.add(child.pid);

			runner.kill("SIGTERM");
			const result = await Promise.race([
				exited,
				sleep(15_000).then(() => {
					throw new Error(`Runner did not exit after SIGTERM.\n${output}`);
				}),
			]);

			expect(result.code).toBe(143);
			expect(result.signal).toBeNull();

			await waitFor(
				async () => {
					try {
						await access(tempRoot);
						return false;
					} catch {
						return true;
					}
				},
				10_000,
				() => `Temporary E2E root was not removed: ${tempRoot}`,
			);

			const pidList = [...ownedPids];
			await waitFor(
				async () => {
					for (const pid of pidList) if (await isAlive(pid)) return false;
					return true;
				},
				10_000,
				() => `Runner-owned processes remained:\n${output}`,
			);
		},
		120_000,
	);
});
