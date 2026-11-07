/**
 * Sends a signal to every child process that has not exited yet.
 *
 * `child.killed` only records that a signal was sent; it stays true even when the process is
 * still alive. `exitCode` and `signalCode` remain null until the child actually exits, so they
 * are the correct gate for SIGTERM -> SIGKILL escalation.
 *
 * @param {Iterable<{ kill: (signal: NodeJS.Signals) => boolean; exitCode: number | null; signalCode: NodeJS.Signals | null }>} children
 * @param {NodeJS.Signals} signal
 * @returns {number} number of children signaled
 */
export const signalRunningChildren = (children, signal) => {
	let signaled = 0;

	for (const child of children) {
		if (child.exitCode !== null || child.signalCode !== null) continue;

		child.kill(signal);
		signaled += 1;
	}

	return signaled;
};
