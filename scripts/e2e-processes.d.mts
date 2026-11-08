export type WindowsTreeKillChild = {
	once: (event: "error", listener: (error: Error) => void) => unknown;
	once: (event: "exit", listener: (code: number | null, signal: string | null) => void) => unknown;
	off: (event: "error" | "exit", listener: (...args: never[]) => void) => unknown;
	kill?: (signal?: string) => boolean;
};

export function waitForSpawn(child: {
	once: (event: "spawn", listener: () => void) => unknown;
	once: (event: "error", listener: (error: Error) => void) => unknown;
	off: (event: "spawn" | "error", listener: (...args: never[]) => void) => unknown;
}): Promise<unknown>;

export type WindowsTreeKillSpawn = (
	command: string,
	args: string[],
	options: { stdio: "ignore"; windowsHide: true; shell: false },
) => WindowsTreeKillChild;

export function windowsTreeKillCommand(pid: number): {
	command: "taskkill.exe";
	args: [string, string, string, string];
};

export function killWindowsProcessTree(
	pid: number,
	options?: { spawnImpl?: WindowsTreeKillSpawn; timeoutMs?: number; graceTimeoutMs?: number },
): Promise<boolean>;

export function planE2ECleanup(
	results: readonly boolean[],
	exitCode: number,
): { cleaned: boolean; removeTempRoot: boolean; exitCode: number };

export type WindowsStopResult = {
	ok: boolean;
	attempted: boolean;
	treeKillSucceeded: boolean | null;
	childExited: boolean;
	fallbackUsed?: boolean;
};

export type WindowsStopChild = WindowsTreeKillChild & {
	pid?: number;
	exitCode?: number | null;
	signalCode?: string | null;
};

export function stopWindowsProcessTree(
	child: WindowsStopChild | null | undefined,
	options?: {
		spawnImpl?: WindowsTreeKillSpawn;
		timeoutMs?: number;
		waitForExit?: (child: WindowsTreeKillChild, timeoutMs: number) => Promise<void>;
	},
): Promise<WindowsStopResult>;
