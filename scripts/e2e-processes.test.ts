import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	killWindowsProcessTree,
	planE2ECleanup,
	stopWindowsProcessTree,
	waitForSpawn,
	windowsTreeKillCommand,
} from "./e2e-processes.mjs";

type FakeChild = EventEmitter & { kill: ReturnType<typeof vi.fn> };

const fakeChild = (): FakeChild => {
	const child = new EventEmitter() as FakeChild;
	child.kill = vi.fn();
	return child;
};

describe("Windows process-tree cleanup", () => {
	it("builds the exact taskkill tree command", () => {
		expect(windowsTreeKillCommand(4321)).toEqual({
			command: "taskkill.exe",
			args: ["/PID", "4321", "/T", "/F"],
		});
	});

	it("spawns taskkill with argument arrays and settles true on a clean exit", async () => {
		const calls: unknown[] = [];
		const child = fakeChild();
		const spawnImpl = vi.fn((command: string, args: string[], options: unknown) => {
			calls.push({ command, args, options });
			setImmediate(() => child.emit("exit", 0, null));
			return child;
		});

		await expect(
			killWindowsProcessTree(4321, { spawnImpl: spawnImpl as never }),
		).resolves.toBe(true);

		expect(calls).toEqual([
			{
				command: "taskkill.exe",
				args: ["/PID", "4321", "/T", "/F"],
				options: { stdio: "ignore", windowsHide: true, shell: false },
			},
		]);
	});

	it("settles false when taskkill cannot be spawned", async () => {
		const child = fakeChild();
		const spawnImpl = vi.fn(() => {
			setImmediate(() => child.emit("error", new Error("taskkill unavailable")));
			return child;
		});

		await expect(
			killWindowsProcessTree(99, { spawnImpl: spawnImpl as never }),
		).resolves.toBe(false);
	});

	it("settles false on a nonzero exit without waiting for a timeout", async () => {
		const child = fakeChild();
		const spawnImpl = vi.fn(() => {
			setImmediate(() => child.emit("exit", 1, null));
			return child;
		});

		await expect(
			killWindowsProcessTree(7, { spawnImpl: spawnImpl as never }),
		).resolves.toBe(false);
	});

	it("waits for taskkill to exit after SIGKILL on timeout, then resolves false", async () => {
		vi.useFakeTimers();
		try {
			const child = fakeChild();
			const spawnImpl = vi.fn(() => child);
			const pending = killWindowsProcessTree(42, {
				spawnImpl: spawnImpl as never,
				timeoutMs: 25,
				graceTimeoutMs: 50,
			});
			let settled = false;
			void pending.then(() => {
				settled = true;
			});

			expect(child.listenerCount("error")).toBe(1);
			expect(child.listenerCount("exit")).toBe(1);

			await vi.advanceTimersByTimeAsync(25);
			expect(child.kill).toHaveBeenCalledWith("SIGKILL");
			expect(settled).toBe(false);
			expect(child.listenerCount("error")).toBe(1);
			expect(child.listenerCount("exit")).toBe(1);
			expect(vi.getTimerCount()).toBe(1);

			// A taskkill helper that exits cleanly after being SIGKILLed does not turn the original
			// timed-out tree-kill attempt into a success.
			child.emit("exit", 0, null);
			await expect(pending).resolves.toBe(false);
			expect(child.listenerCount("error")).toBe(0);
			expect(child.listenerCount("exit")).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(["exit", "error"] as const)(
		"does not schedule a grace timer when SIGKILL synchronously emits %s",
		async (event) => {
			vi.useFakeTimers();
			try {
				const child = fakeChild();
				child.kill = vi.fn(() => {
					if (event === "exit") child.emit("exit", 0, null);
					else child.emit("error", new Error("synchronous taskkill failure"));
					return true;
				});
				const spawnImpl = vi.fn(() => child);
				const pending = killWindowsProcessTree(44, {
					spawnImpl: spawnImpl as never,
					timeoutMs: 25,
					graceTimeoutMs: 50,
				});

				await vi.advanceTimersByTimeAsync(25);

				await expect(pending).resolves.toBe(false);
				expect(child.kill).toHaveBeenCalledWith("SIGKILL");
				expect(child.listenerCount("error")).toBe(0);
				expect(child.listenerCount("exit")).toBe(0);
				expect(vi.getTimerCount()).toBe(0);
			} finally {
				vi.useRealTimers();
			}
		},
	);

	it("resolves false when the post-SIGKILL grace period expires without an exit event", async () => {
		vi.useFakeTimers();
		try {
			const child = fakeChild();
			const spawnImpl = vi.fn(() => child);
			const pending = killWindowsProcessTree(43, {
				spawnImpl: spawnImpl as never,
				timeoutMs: 25,
				graceTimeoutMs: 40,
			});
			let settled = false;
			void pending.then(() => {
				settled = true;
			});

			await vi.advanceTimersByTimeAsync(25);
			expect(child.kill).toHaveBeenCalledWith("SIGKILL");
			expect(settled).toBe(false);
			expect(child.listenerCount("error")).toBe(1);
			expect(child.listenerCount("exit")).toBe(1);

			await vi.advanceTimersByTimeAsync(40);
			await expect(pending).resolves.toBe(false);
			expect(settled).toBe(true);
			expect(child.listenerCount("error")).toBe(0);
			expect(child.listenerCount("exit")).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("never invokes taskkill for an already-exited child", async () => {
		const child = Object.assign(fakeChild(), {
			pid: 123,
			exitCode: 0,
			signalCode: null as string | null,
		});
		const spawnImpl = vi.fn();

		const result = await stopWindowsProcessTree(child as never, { spawnImpl: spawnImpl as never });

		expect(spawnImpl).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: true,
			attempted: false,
			treeKillSucceeded: null,
			childExited: true,
		});
	});

	it("reports cleanup failure when taskkill fails, even if the direct child exits", async () => {
		const child = Object.assign(fakeChild(), {
			pid: 456,
			exitCode: null as number | null,
			signalCode: null as string | null,
		});
		child.kill = vi.fn(() => {
			child.exitCode = 1;
			return true;
		});
		const taskkill = fakeChild();
		const spawnImpl = vi.fn(() => {
			setImmediate(() => taskkill.emit("error", new Error("taskkill failed")));
			return taskkill;
		});
		const waitForExit = vi.fn(async () => undefined);

		const result = await stopWindowsProcessTree(child as never, {
			spawnImpl: spawnImpl as never,
			waitForExit,
		});

		expect(result).toMatchObject({
			ok: false,
			attempted: true,
			treeKillSucceeded: false,
			childExited: true,
			fallbackUsed: true,
		});
		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	});

	it("waits for a child spawn event and removes its listeners", async () => {
		const child = fakeChild();
		const pending = waitForSpawn(child as never);
		expect(child.listenerCount("spawn")).toBe(1);
		child.emit("spawn");
		await expect(pending).resolves.toBe(child);
		expect(child.listenerCount("spawn")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	});

	it("rejects immediately on a child spawn error and removes its listeners", async () => {
		const child = fakeChild();
		const pending = waitForSpawn(child as never);
		child.emit("error", new Error("spawn ENOENT"));
		await expect(pending).rejects.toThrow("spawn ENOENT");
		expect(child.listenerCount("spawn")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	});

	it("withholds temp-root removal and returns nonzero after a simulated Windows kill failure", () => {
		const normalFailure = planE2ECleanup([false, true], 0);
		expect(normalFailure).toEqual({ cleaned: false, removeTempRoot: false, exitCode: 1 });

		const interruptedFailure = planE2ECleanup([true, false], 143);
		expect(interruptedFailure).toEqual({ cleaned: false, removeTempRoot: false, exitCode: 143 });

		const success = planE2ECleanup([true, true], 0);
		expect(success).toEqual({ cleaned: true, removeTempRoot: true, exitCode: 0 });
	});

	it("deduplicates concurrent stops for the same child", async () => {
		const child = Object.assign(fakeChild(), {
			pid: 789,
			exitCode: null as number | null,
			signalCode: null as string | null,
		});
		const taskkill = fakeChild();
		const spawnImpl = vi.fn(() => {
			setImmediate(() => taskkill.emit("exit", 0, null));
			return taskkill;
		});
		const waitForExit = vi.fn(async () => {
			child.exitCode = 0;
		});

		const first = stopWindowsProcessTree(child as never, {
			spawnImpl: spawnImpl as never,
			waitForExit,
		});
		// A later finally cleanup must still await the taskkill already in progress, even if the
		// direct child has exited by then.
		child.exitCode = 0;
		const second = stopWindowsProcessTree(child as never, {
			spawnImpl: spawnImpl as never,
			waitForExit,
		});
		expect(second).toBe(first);
		const [a, b] = await Promise.all([first, second]);

		expect(spawnImpl).toHaveBeenCalledTimes(1);
		expect(a).toBe(b);
		expect(a.ok).toBe(true);
	});
});
