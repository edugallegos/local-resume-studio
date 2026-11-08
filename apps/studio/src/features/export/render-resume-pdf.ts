import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createResumePdfBlob } from "@reactive-resume/pdf/browser";
import { createSafeRenderCopy } from "./safe-render-copy";

/** The render result shared by the live preview and the download action. */
export type ResumePdfRender = {
	/** The exact bytes the preview shows and the download archives. */
	blob: Blob;
	/** Header, section and item boxes in PDF points, for semantic overlay highlighting. */
	pageMap: PageMap;
	/** Font families Forme could not download; the PDF used its built-in fallback. */
	missingFonts: string[];
	/** Characters no font could draw, named as Forme reports them (`"₹" (U+20B9)`). */
	lostCharacters: string[];
};

/**
 * Renders the resume through the pinned Reactive Resume PDF browser adapter. The input is a safe render-only
 * copy: the saved draft is never modified, and a missing font never strands the editor.
 */
export const renderResumePdf = async (data: ResumeData): Promise<ResumePdfRender> => {
	const safe = createSafeRenderCopy(data);
	let pageMap: PageMap = { pages: [], nodes: [] };
	let missingFonts: string[] = [];
	let lostCharacters: string[] = [];

	const blob = await createResumePdfBlob({
		data: safe.data,
		// The editor opts in explicitly: report missing faces and continue with Forme's fallback.
		allowMissingFonts: true,
		onMissingFonts: (fonts) => {
			missingFonts = fonts;
		},
		onPageMap: (map) => {
			pageMap = map;
		},
		onLostCharacters: (characters) => {
			lostCharacters = characters;
		},
	});

	return {
		blob,
		pageMap,
		missingFonts: [...new Set(missingFonts)],
		lostCharacters: [...new Set(lostCharacters)],
	};
};
