import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planE2ECleanup, stopWindowsProcessTree, waitForSpawn } from "./e2e-processes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const detached = process.platform !== "win32";

let dev;
let playwright;
let interruptedSignal = null;

const signalExitCode = { SIGINT: 130, SIGTERM: 143 };

const signalChild = (child, signal) => {
	if (!child?.pid) return;
	try {
		if (detached) process.kill(-child.pid, signal);
		else child.kill(signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// Already gone.
		}
	}
};

const waitForExit = (child, timeoutMs) =>
	new Promise((resolveExit) => {
		if (!child || child.exitCode !== null || child.signalCode !== null) {
			resolveExit();
			return;
		}
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolveExit();
		}, timeoutMs);
		child.once("exit", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveExit();
		});
	});

const groupAlive = (pid) => {
	if (!detached) return false;
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
};

const waitForGroupExit = async (pid, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!groupAlive(pid)) return true;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	return !groupAlive(pid);
};

const stop = async (child) => {
	if (!child?.pid) return true;

	if (process.platform === "win32") {
		const result = await stopWindowsProcessTree(child, { waitForExit });
		return result.ok;
	}

	signalChild(child, "SIGTERM");
	await waitForExit(child, 3000);
	signalChild(child, "SIGKILL");
	await waitForExit(child, 1000);
	return waitForGroupExit(child.pid, 1000);
};

const startWindowsStop = (child) => {
	if (!child?.pid) return;
	void stopWindowsProcessTree(child, { waitForExit }).catch(() => undefined);
};

const requestStop = (signal) => {
	const windowsForce = process.platform === "win32";
	if (interruptedSignal) {
		if (windowsForce) {
			startWindowsStop(playwright);
			startWindowsStop(dev);
		} else {
			signalChild(playwright, "SIGKILL");
			signalChild(dev, "SIGKILL");
		}
		return;
	}
	interruptedSignal = signal;
	if (windowsForce) {
		startWindowsStop(playwright);
		startWindowsStop(dev);
	} else {
		signalChild(playwright, "SIGTERM");
		signalChild(dev, "SIGTERM");
	}
};

process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

const listenOnFreePort = () =>
	new Promise((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Could not allocate a loopback port.")));
				return;
			}
			resolvePort({ server, port: address.port });
		});
	});

const freePorts = async (count) => {
	const held = [];
	try {
		for (let index = 0; index < count; index += 1) held.push(await listenOnFreePort());
		return held.map(({ port }) => port);
	} finally {
		await Promise.all(
			held.map(
				({ server }) =>
					new Promise((resolveClose) => {
						server.close(() => resolveClose(undefined));
					}),
			),
		);
	}
};

const waitForHealth = async (url, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	let lastError = "no response";

	while (Date.now() < deadline) {
		if (interruptedSignal) throw new Error("Interrupted.");
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
			if (response.ok) {
				const body = await response.json();
				if (body?.status === "ok") return;
				lastError = `health returned ${JSON.stringify(body)}`;
			} else {
				lastError = `health returned HTTP ${response.status}`;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 200));
	}

	throw new Error(`Timed out waiting for ${url}: ${lastError}`);
};

const runPlaywright = (args, env) =>
	new Promise((resolveRun) => {
		playwright = spawn(process.execPath, args, {
			cwd: root,
			env,
			stdio: "inherit",
			detached,
		});
		playwright.on("error", (error) => {
			console.error(`[e2e] Could not start Playwright: ${error.message}`);
			resolveRun(1);
		});
		playwright.on("exit", (code, signal) => resolveRun(interruptedSignal ? 1 : signal ? 1 : (code ?? 1)));
	});

const [uiPort, apiPort] = await freePorts(2);
const tempRoot = await mkdtemp(join(tmpdir(), "local-resume-e2e-"));
const baseURL = `http://127.0.0.1:${uiPort}`;
const sharedEnv = {
	...process.env,
	RESUME_DATA_DIR: tempRoot,
	E2E_DATA_DIR: tempRoot,
	E2E_BASE_URL: baseURL,
	E2E_OUTPUT_DIR: join(tempRoot, "test-results"),
};

let exitCode = 1;
try {
	dev = spawn(
		process.execPath,
		[join(root, "scripts/dev.mjs"), "--ui-port", String(uiPort), "--api-port", String(apiPort)],
		{
			cwd: root,
			env: {
				...sharedEnv,
				STUDIO_UI_PORT: String(uiPort),
				STUDIO_API_PORT: String(apiPort),
			},
			stdio: "inherit",
			detached,
		},
	);
	await waitForSpawn(dev);

	await waitForHealth(`${baseURL}/api/health`, 60_000);
	if (interruptedSignal) throw new Error("Interrupted.");

	exitCode = await runPlaywright(
		[join(root, "node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
		sharedEnv,
	);
	if (interruptedSignal) exitCode = signalExitCode[interruptedSignal];
} catch (error) {
	if (interruptedSignal) exitCode = signalExitCode[interruptedSignal];
	else {
		console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
		exitCode = 1;
	}
} finally {
	const cleanup = await Promise.all([
		stop(playwright).catch(() => false),
		stop(dev).catch(() => false),
	]);
	const plan = planE2ECleanup(cleanup, exitCode);
	exitCode = plan.exitCode;

	if (!plan.removeTempRoot) {
		console.error("[e2e] Cleanup could not confirm every runner-owned process tree stopped.");
		console.error(`[e2e] Retaining temporary data directory for manual cleanup: ${tempRoot}`);
	} else {
		await rm(tempRoot, { recursive: true, force: true });
	}
}

process.exit(exitCode);
