import type { ResumeData } from "@reactive-resume/schema/resume/data";

/** A resume as shown in the library, without loading its document body. */
export type ResumeListItem = {
	id: string;
	label: string;
	fullName: string;
	updatedAt: string;
};

/** A resume document together with the ETag of its exact on-disk bytes. */
export type StoredResume = ResumeListItem & {
	data: ResumeData;
	etag: string;
};

/** A PDF export written to the local archive. */
export type PdfExportResult = {
	filename: string;
};
