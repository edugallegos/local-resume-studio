import type { ResumeApiClient } from "../../api/client";

export type SavePdfFile = (filename: string, blob: Blob) => void;

/** Hands a Blob to the browser's download flow without navigating away from the editor. */
export const savePdfFile: SavePdfFile = (filename, blob) => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = "noopener";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	// Revoke after the click's download task has captured the object URL.
	setTimeout(() => URL.revokeObjectURL(url), 0);
};

export type DownloadPdfInput = {
	client: Pick<ResumeApiClient, "exportPdf">;
	id: string;
	/** The exact Blob the preview rendered. */
	blob: Blob;
	fallbackFilename: string;
	/** Injectable for tests; defaults to a temporary object-URL download. */
	save?: SavePdfFile;
};

/**
 * Archives the previewed PDF through POST /api/resumes/:id/exports, then downloads those same bytes locally.
 * The server's size cap and local archive behaviour stay authoritative; no second render happens here.
 */
export const downloadPdf = async ({
	client,
	id,
	blob,
	fallbackFilename,
	save = savePdfFile,
}: DownloadPdfInput): Promise<string> => {
	const { filename } = await client.exportPdf(id, blob);
	const finalFilename = filename.trim() !== "" ? filename : fallbackFilename;
	save(finalFilename, blob);
	return finalFilename;
};
