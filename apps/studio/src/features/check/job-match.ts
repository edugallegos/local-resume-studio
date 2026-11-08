import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import type { JdMatchReport } from "@reactive-resume/resume/ats-pdf";
import { matchJobDescription } from "@reactive-resume/resume/ats-pdf";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import type { ResumeData } from "@reactive-resume/schema/resume/data";

/**
 * Compares a pasted posting with the same visible resume text the export uses. Coverage is returned
 * separately from the ATS score and stays entirely local.
 */
export const matchPastedJob = (data: ResumeData, posting: string): JdMatchReport | null => {
	const jobDescription = posting.trim();
	if (jobDescription === "") return null;

	const resumeText = buildMarkdown(data, (sectionId) => getResumeSectionTitle(data, sectionId));
	return matchJobDescription({ jobDescription, resumeText });
};
