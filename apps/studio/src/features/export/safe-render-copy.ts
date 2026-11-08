import type { ResumeData } from "@reactive-resume/schema/resume/data";

/**
 * A render-only copy of resume data plus the local warnings raised while making it safe.
 * The saved document is never modified: every difference exists only in this copy.
 */
export type SafeRenderCopy = {
	data: ResumeData;
	warnings: string[];
};

type UnknownRecord = Record<string, unknown>;

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_TAG = /<\/?script\b[^>]*>/gi;
const PAIRED_MEDIA = /<(iframe|object|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const VOID_MEDIA = /<(?:embed|source|track|link|base|meta)\b[^>]*\/?>/gi;
const LEFTOVER_MEDIA = /<\/?(?:iframe|object|video|audio)\b[^>]*>/gi;
const IMAGE_TAG = /<img\b[^>]*\/?>/gi;
const REMOTE_STYLE_URL = /url\(\s*(['"]?)(?!data:)[^)]*\)/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_HREF = /\shref\s*=\s*(["'])\s*javascript:[^"']*\1/gi;

const srcAttribute = (tag: string): string | null => {
	const match = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
	return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

/** A data URI is embedded in the resume JSON; anything else could make the renderer reach the network. */
export const isEmbeddedImageUrl = (value: string): boolean => /^data:image\/[a-z0-9.+-]+(?:;|,)/i.test(value.trim());

/**
 * Removes active markup and remote image references from rich text. Only tags that are inert in Forme's
 * HTML subset survive. The caller sees a warning when something was dropped.
 */
export const sanitizeRichText = (html: string, warnings: Set<string>): string => {
	if (html.trim() === "") return html;

	let safe = html;

	const replaceScripts = safe.replace(SCRIPT_BLOCK, "").replace(SCRIPT_TAG, "");
	if (replaceScripts !== safe) warnings.add("Removed script markup from rich text.");
	safe = replaceScripts;

	const replacedMedia = safe.replace(PAIRED_MEDIA, "").replace(VOID_MEDIA, "").replace(LEFTOVER_MEDIA, "");
	if (replacedMedia !== safe) warnings.add("Removed embedded media markup from rich text.");
	safe = replacedMedia;

	safe = safe.replace(IMAGE_TAG, (tag) => {
		const src = srcAttribute(tag);
		if (src !== null && isEmbeddedImageUrl(src)) {
			// srcset could still point at a remote image; Forme only draws the embedded src.
			return tag.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\ssizes\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
		}
		warnings.add("Removed a non-embedded image from rich text.");
		return "";
	});

	const replacedUrls = safe.replace(REMOTE_STYLE_URL, "none");
	if (replacedUrls !== safe) warnings.add("Removed a remote style URL from rich text.");
	safe = replacedUrls.replace(EVENT_HANDLER, "").replace(JAVASCRIPT_HREF, ' href=""');

	return safe;
};

const sanitizeItem = (item: unknown, warnings: Set<string>): void => {
	if (typeof item !== "object" || item === null) return;
	const record = item as UnknownRecord;

	for (const key of ["content", "description", "recipient"] as const) {
		const value = record[key];
		if (typeof value === "string") record[key] = sanitizeRichText(value, warnings);
	}

	if (Array.isArray(record.roles)) {
		for (const role of record.roles) sanitizeItem(role, warnings);
	}
};

/**
 * Builds the copy handed to `createResumePdfBlob`. It removes script and remote-image markup from every
 * rich-text-bearing section, suppresses non-embedded portrait URLs, and leaves the saved JSON untouched.
 */
export const createSafeRenderCopy = (data: ResumeData): SafeRenderCopy => {
	const copy = structuredClone(data);
	const warnings = new Set<string>();

	copy.summary.content = sanitizeRichText(copy.summary.content, warnings);
	for (const section of Object.values(copy.sections)) {
		for (const item of section.items) sanitizeItem(item, warnings);
	}
	for (const section of copy.customSections) {
		for (const item of section.items) sanitizeItem(item, warnings);
	}

	const pictureUrl = copy.picture.url.trim();
	if (pictureUrl !== "" && !isEmbeddedImageUrl(pictureUrl)) {
		warnings.add(
			`Picture URL suppressed because it is not embedded in the resume file: ${pictureUrl.slice(0, 120)}`,
		);
		copy.picture.url = "";
	} else {
		copy.picture.url = pictureUrl;
	}

	return { data: copy, warnings: [...warnings] };
};
