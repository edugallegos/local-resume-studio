import type { ResumeData } from "@reactive-resume/schema/resume/data";
import {
	DENSITY_PRESETS,
	MARGIN_PRESETS,
	type DesignDensity,
	type FitDesignState,
	type MarginPreset,
} from "../write/resume-edits";

export const FIT_MIN_SIZE = 9;
export const FIT_SIZE_STEP = 0.5;
export const FIT_RENDER_TIMEOUT_MS = 8000;

export type FitState = {
	density: DesignDensity | null;
	margins: MarginPreset | null;
	size: number;
};

export type FitStep =
	| { type: "density"; density: DesignDensity }
	| { type: "margins"; margins: MarginPreset }
	| { type: "size"; size: number };

export type FitMeasure = (afterStep: boolean) => Promise<"fit" | "overflow" | "timeout">;

export type FitResult = {
	status: "fits" | "exhausted" | "timeout" | "interrupted";
	state: FitState;
	applied: boolean;
};

const DENSITY_ORDER: DesignDensity[] = ["spacious", "comfortable", "compact"];
const MARGIN_ORDER: MarginPreset[] = ["wide", "normal", "narrow"];

export const matchDensity = (metadata: ResumeData["metadata"]): DesignDensity | null => {
	const { gapX, gapY } = metadata.page;
	const { body, heading } = metadata.typography;
	return (
		(Object.entries(DENSITY_PRESETS) as [DesignDensity, (typeof DENSITY_PRESETS)[DesignDensity]][]).find(
			([, preset]) =>
				preset.gapX === gapX &&
				preset.gapY === gapY &&
				preset.bodyLineHeight === body.lineHeight &&
				preset.headingLineHeight === heading.lineHeight,
		)?.[0] ?? null
	);
};

export const matchMargins = (metadata: ResumeData["metadata"]): MarginPreset | null => {
	const { marginX, marginY } = metadata.page;
	return (
		(Object.entries(MARGIN_PRESETS) as [MarginPreset, (typeof MARGIN_PRESETS)[MarginPreset]][]).find(
			([, preset]) => preset.marginX === marginX && preset.marginY === marginY,
		)?.[0] ?? null
	);
};

const tighter = <T extends string>(order: readonly T[], current: T | null): T | null => {
	if (current === null) return order.at(-1) ?? null;
	const index = order.indexOf(current);
	const next = index === -1 ? order.at(-1) : order[index + 1];
	return next && next !== current ? next : null;
};

/** Density first, then margins, then body text in 0.5 pt steps, never below 9 pt. */
export const nextFitStep = (state: FitState): FitStep | null => {
	const density = tighter(DENSITY_ORDER, state.density);
	if (density) return { type: "density", density };
	const margins = tighter(MARGIN_ORDER, state.margins);
	if (margins) return { type: "margins", margins };
	if (state.size > FIT_MIN_SIZE) {
		return {
			type: "size",
			size: Math.max(FIT_MIN_SIZE, Math.round((state.size - FIT_SIZE_STEP) * 2) / 2),
		};
	}
	return null;
};

export const mergeFitState = (state: FitState, step: FitStep): FitState => {
	if (step.type === "density") return { ...state, density: step.density };
	if (step.type === "margins") return { ...state, margins: step.margins };
	return { ...state, size: step.size };
};

export const fitStateOf = (metadata: ResumeData["metadata"]): FitState => ({
	density: matchDensity(metadata),
	margins: matchMargins(metadata),
	size: metadata.typography.body.fontSize,
});

/** Captures only what Fit can change, for a clean revert after a failed run. */
export const captureFitState = (metadata: ResumeData["metadata"]): FitDesignState => ({
	page: {
		gapX: metadata.page.gapX,
		gapY: metadata.page.gapY,
		marginX: metadata.page.marginX,
		marginY: metadata.page.marginY,
	},
	typography: {
		body: {
			fontSize: metadata.typography.body.fontSize,
			lineHeight: metadata.typography.body.lineHeight,
		},
		heading: {
			fontSize: metadata.typography.heading.fontSize,
			lineHeight: metadata.typography.heading.lineHeight,
		},
	},
});

type FitToPagesOptions = {
	initial: FitState;
	/** Resolves only after a completed render, or reports a timeout. */
	measure: FitMeasure;
	apply: (step: FitStep) => void;
	isInterrupted?: () => boolean;
	/** Hard guard against a loop that never measures a fit; the real stop is the step plan. */
	maxSteps?: number;
};

/**
 * Runs Fit one step at a time. A step is applied only after a completed render says the pages still overflow,
 * and success is reported only after a completed render says they fit.
 */
export async function fitToPages({
	initial,
	measure,
	apply,
	isInterrupted = () => false,
	maxSteps = 32,
}: FitToPagesOptions): Promise<FitResult> {
	let state = initial;
	let applied = false;

	for (let stepCount = 0; stepCount <= maxSteps; stepCount++) {
		if (isInterrupted()) return { status: "interrupted", state, applied };
		const outcome = await measure(applied);
		if (isInterrupted()) return { status: "interrupted", state, applied };
		if (outcome === "timeout") return { status: "timeout", state, applied };
		if (outcome === "fit") return { status: "fits", state, applied };

		const step = nextFitStep(state);
		if (!step) return { status: "exhausted", state, applied };
		if (isInterrupted()) return { status: "interrupted", state, applied };

		apply(step);
		state = mergeFitState(state, step);
		applied = true;
	}

	return { status: "exhausted", state, applied };
}
