export type SignalableChild = {
	kill(signal: NodeJS.Signals): boolean;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
};

export function signalRunningChildren(children: Iterable<SignalableChild>, signal: NodeJS.Signals): number;
