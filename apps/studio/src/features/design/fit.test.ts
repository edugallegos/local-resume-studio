import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it, vi } from "vitest";
import { DENSITY_PRESETS, MARGIN_PRESETS } from "../write/resume-edits";
import { fitToPages, matchDensity, matchMargins, nextFitStep, type FitState } from "./fit";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const metadata = (): ResumeData["metadata"] => structuredClone(defaultResumeData.metadata);

describe("fit step planning", () => {
	it("matches density and margin presets", () => {
		const base = metadata();
		expect(matchDensity(base)).toBe("comfortable");
		expect(matchMargins(base)).toBe("normal");
		expect(DENSITY_PRESETS.comfortable.gapY).toBe(base.page.gapY);
		expect(MARGIN_PRESETS.normal.marginY).toBe(base.page.marginY);
	});

	it("tightens density before margins before text size", () => {
		const state: FitState = { density: "spacious", margins: "wide", size: 10.5 };
		const first = nextFitStep(state);
		expect(first).toEqual({ type: "density", density: "comfortable" });

		const second = nextFitStep({ ...state, density: "comfortable" });
		expect(second).toEqual({ type: "density", density: "compact" });

		const third = nextFitStep({ ...state, density: "compact" });
		expect(third).toEqual({ type: "margins", margins: "normal" });

		const fourth = nextFitStep({ ...state, density: "compact", margins: "normal" });
		expect(fourth).toEqual({ type: "margins", margins: "narrow" });

		const fifth = nextFitStep({ ...state, density: "compact", margins: "narrow" });
		expect(fifth).toEqual({ type: "size", size: 10 });
	});

	it("stops at the 9 pt minimum", () => {
		expect(nextFitStep({ density: "compact", margins: "narrow", size: 9.5 })).toEqual({
			type: "size",
			size: 9,
		});
		expect(nextFitStep({ density: "compact", margins: "narrow", size: 9 })).toBeNull();
	});
});

describe("fitToPages", () => {
	it("applies steps in order until a completed render fits", async () => {
		const outcomes: ("overflow" | "fit")[] = ["overflow", "overflow", "fit"];
		const apply = vi.fn();
		const result = await fitToPages({
			initial: { density: "comfortable", margins: "normal", size: 10 },
			measure: async () => outcomes.shift() ?? "fit",
			apply,
		});

		expect(apply).toHaveBeenCalledTimes(2);
		expect(apply).toHaveBeenNthCalledWith(1, { type: "density", density: "compact" });
		expect(apply).toHaveBeenNthCalledWith(2, { type: "margins", margins: "narrow" });
		expect(result.status).toBe("fits");
		expect(result.applied).toBe(true);
		expect(result.state).toEqual({ density: "compact", margins: "narrow", size: 10 });
	});

	it("steps text size by 0.5 pt down to 9 and reports exhaustion", async () => {
		const sizes: number[] = [];
		const result = await fitToPages({
			initial: { density: "compact", margins: "narrow", size: 10 },
			measure: async () => "overflow",
			apply: (step) => {
				if (step.type === "size") sizes.push(step.size);
			},
		});

		expect(sizes).toEqual([9.5, 9]);
		expect(result).toEqual({
			status: "exhausted",
			state: { density: "compact", margins: "narrow", size: 9 },
			applied: true,
		});
	});

	it("does nothing when the initial completed render already fits", async () => {
		const apply = vi.fn();
		const result = await fitToPages({
			initial: { density: "comfortable", margins: "normal", size: 10 },
			measure: async () => "fit",
			apply,
		});

		expect(apply).not.toHaveBeenCalled();
		expect(result.status).toBe("fits");
		expect(result.applied).toBe(false);
	});

	it("stops on a render timeout without applying further steps or claiming a fit", async () => {
		const apply = vi.fn();
		const result = await fitToPages({
			initial: { density: "comfortable", margins: "normal", size: 10 },
			measure: async () => "timeout",
			apply,
		});

		expect(apply).not.toHaveBeenCalled();
		expect(result.status).toBe("timeout");
		expect(result.applied).toBe(false);
	});

	it("stops when a newer edit supersedes the run", async () => {
		let interrupted = false;
		const apply = vi.fn(() => {
			interrupted = true;
		});
		const result = await fitToPages({
			initial: { density: "comfortable", margins: "normal", size: 10 },
			measure: async () => "overflow",
			apply,
			isInterrupted: () => interrupted,
		});

		expect(apply).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("interrupted");
		expect(result.applied).toBe(true);
	});
});
