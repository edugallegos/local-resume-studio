import { describe, expect, it, vi } from "vitest";
import { signalRunningChildren, type SignalableChild } from "./dev-processes.mjs";

type FakeChild = SignalableChild & {
	killed: boolean;
};

const createChild = (overrides: Partial<FakeChild> = {}): FakeChild => ({
	killed: false,
	exitCode: null,
	signalCode: null,
	kill: vi.fn(() => true),
	...overrides,
});

describe("signalRunningChildren", () => {
	it.each(["SIGTERM", "SIGKILL"] as const)(
		"signals an already-signaled child with %s while it is still running",
		(signal) => {
			const child = createChild({ killed: true, exitCode: null, signalCode: null });

			const signaled = signalRunningChildren([child], signal);

			expect(signaled).toBe(1);
			expect(child.kill).toHaveBeenCalledWith(signal);
			expect(child.kill).toHaveBeenCalledTimes(1);
		},
	);

	it("skips children that have already exited or terminated", () => {
		const exited = createChild({ exitCode: 0 });
		const terminated = createChild({ signalCode: "SIGTERM" });
		const running = createChild();

		const signaled = signalRunningChildren([exited, terminated, running], "SIGTERM");

		expect(signaled).toBe(1);
		expect(exited.kill).not.toHaveBeenCalled();
		expect(terminated.kill).not.toHaveBeenCalled();
		expect(running.kill).toHaveBeenCalledWith("SIGTERM");
	});
});
