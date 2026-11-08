import { spawn } from "node:child_process";

export const windowsTreeKillCommand = (pid) => ({
	command: "taskkill.exe",
	args: ["/PID", String(pid), "/T", "/F"],
});

/** Launch `pnpm start` without a shell on POSIX, and through fixed cmd.exe arguments on Windows. */
export const pnpmStartCommand = ({ platform = process.platform, comSpec = process.env.ComSpec } = {}) => {
	if (platform === "win32") {
		return {
			command: comSpec?.trim() || "cmd.exe",
			args: ["/d", "/s", "/c", "pnpm start"],
		};
	}
	return { command: "pnpm", args: ["start"] };
};

const windowsStops = new WeakMap();

const hasExited = (child) => !child || child.exitCode !== null || child.signalCode !== null;

/** Resolve only once the OS confirms the child spawned; surface spawn failures immediately. */
export const waitForSpawn = (child) =>
	new Promise((resolveSpawn, rejectSpawn) => {
		let settled = false;
		const cleanup = () => {
			child.off("spawn", onSpawn);
			child.off("error", onError);
		};
		const onSpawn = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolveSpawn(child);
		};
		const onError = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rejectSpawn(error);
		};
		child.once("spawn", onSpawn);
		child.once("error", onError);
	});

const defaultWaitForExit = (child, timeoutMs) =>
	new Promise((resolveExit) => {
		if (hasExited(child)) {
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

/**
 * Terminates a Windows process and its descendants with `taskkill /T /F`. The direct child fallback
 * remains available to callers when taskkill cannot start or does not exit.
 */
export const killWindowsProcessTree = (pid, options = {}) => {
	const spawnImpl = options.spawnImpl ?? spawn;
	const timeoutMs = options.timeoutMs ?? 5000;
	const graceTimeoutMs = options.graceTimeoutMs ?? 1000;
	const { command, args } = windowsTreeKillCommand(pid);

	return new Promise((resolveKill) => {
		let settled = false;
		let timedOut = false;
		let child;
		let onError;
		let onExit;
		let timer;
		let graceTimer;

		const finish = (success) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (graceTimer) clearTimeout(graceTimer);
			if (child) {
				if (onError) child.off("error", onError);
				if (onExit) child.off("exit", onExit);
			}
			resolveKill(success);
		};

		timer = setTimeout(() => {
			timedOut = true;
			try {
				child?.kill("SIGKILL");
			} catch {
				// Best effort if taskkill itself is stuck.
			}
			// A synchronous exit/error from the injected child may already have settled cleanup.
			if (settled) return;
			// Keep the listeners active until the killed taskkill process exits/errors or the grace
			// period ends. A timeout is never a successful tree kill, even if taskkill exits 0 late.
			graceTimer = setTimeout(() => finish(false), graceTimeoutMs);
		}, timeoutMs);

		try {
			child = spawnImpl(command, args, { stdio: "ignore", windowsHide: true, shell: false });
		} catch {
			finish(false);
			return;
		}

		onError = () => finish(false);
		onExit = (code) => finish(timedOut ? false : code === 0);
		child.once("error", onError);
		child.once("exit", onExit);
	});
};

/** Cleanup only removes the run root when every owned process tree is confirmed stopped. */
export const planE2ECleanup = (results, exitCode) => {
	const cleaned = results.every(Boolean);
	return {
		cleaned,
		removeTempRoot: cleaned,
		exitCode: cleaned ? exitCode : exitCode === 0 ? 1 : exitCode,
	};
};

/**
 * Stops one Windows child and its descendants. Repeated calls for the same child share one taskkill
 * operation, so an interrupt and the later finally cleanup cannot target a recycled PID twice.
 * An already-exited child is never passed to taskkill.
 */
export const stopWindowsProcessTree = (child, options = {}) => {
	if (!child?.pid) {
		return Promise.resolve({ ok: true, attempted: false, treeKillSucceeded: null, childExited: true });
	}

	// A signal-triggered stop may already be running. Await it even if the direct child has since
	// exited, so taskkill has actually finished before tempRoot can be removed.
	const existing = windowsStops.get(child);
	if (existing) return existing;

	if (hasExited(child)) {
		return Promise.resolve({ ok: true, attempted: false, treeKillSucceeded: null, childExited: true });
	}

	const waitForExit = options.waitForExit ?? defaultWaitForExit;
	const stop = (async () => {
		const treeKillSucceeded = await killWindowsProcessTree(child.pid, {
			...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {}),
			...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
		});

		await waitForExit(child, 3000);
		let childExited = hasExited(child);
		let fallbackUsed = false;

		if (!childExited) {
			fallbackUsed = true;
			try {
				child.kill("SIGKILL");
			} catch {
				// Direct fallback is best effort.
			}
			await waitForExit(child, 1000);
			childExited = hasExited(child);
		}

		return {
			ok: treeKillSucceeded && childExited,
			attempted: true,
			treeKillSucceeded,
			childExited,
			fallbackUsed,
		};
	})();

	windowsStops.set(child, stop);
	return stop;
};
