import type { ResumeData } from "@reactive-resume/schema/resume/data";

export function resumeDataRoot(env?: Record<string, string | undefined>): string;

export function listResumeFiles(resumesDir: string): Promise<string[]>;

export function validateResumeFile(path: string): Promise<ResumeData>;

export function runResumeCli(
	argv: string[],
	options?: {
		env?: Record<string, string | undefined>;
		stdout?: (text: string) => void;
		stderr?: (text: string) => void;
	},
): Promise<number>;
