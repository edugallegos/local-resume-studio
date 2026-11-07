import DOMPurify from "dompurify";
import { useMemo } from "react";

/**
 * Formatting-only allowlist for imported resume rich text. Links, images, media, styles, and
 * every attribute are excluded so a stored document can never load a remote resource or run
 * script in the editor. The original stored HTML is left untouched.
 */
export const RICH_TEXT_ALLOWED_TAGS = [
	"p",
	"br",
	"span",
	"div",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"strike",
	"del",
	"ins",
	"mark",
	"small",
	"sub",
	"sup",
	"ul",
	"ol",
	"li",
	"blockquote",
	"code",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"hr",
];

const SANITIZE_OPTIONS = {
	ALLOWED_TAGS: RICH_TEXT_ALLOWED_TAGS,
	ALLOWED_ATTR: [] as string[],
	ALLOW_DATA_ATTR: false,
	KEEP_CONTENT: true,
	FORBID_TAGS: [
		"script",
		"style",
		"iframe",
		"frame",
		"object",
		"embed",
		"img",
		"picture",
		"image",
		"video",
		"audio",
		"source",
		"track",
		"link",
		"meta",
		"form",
		"input",
		"button",
		"textarea",
		"select",
		"option",
		"svg",
		"math",
	],
	FORBID_ATTR: ["style", "src", "srcset", "href", "xlink:href", "onerror", "onload", "onclick"],
};

export const sanitizeRichText = (html: string): string => {
	// DOMPurify is the primary sanitizer and is battle-tested in browsers. Some lightweight DOM
	// implementations (used by the test runner) do not apply its filtering fully, so a strict
	// allowlist pass runs first. It removes every attribute and every resource-bearing or script
	// element before DOMPurify sees the markup; in a real browser the two passes agree.
	const allowlisted = enforceAllowlist(html);
	return DOMPurify.sanitize(allowlisted, SANITIZE_OPTIONS);
};

const DROP_WITH_CONTENT = new Set([
	"script",
	"style",
	"iframe",
	"frame",
	"object",
	"embed",
	"img",
	"picture",
	"image",
	"video",
	"audio",
	"source",
	"track",
	"link",
	"meta",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"option",
	"svg",
	"math",
	"template",
	"noscript",
]);

const allowedTags = new Set(RICH_TEXT_ALLOWED_TAGS);

const cleanChildren = (parent: Node): void => {
	for (const child of Array.from(parent.childNodes)) {
		// Text nodes are safe once every surrounding element and attribute has been checked.
		if (child.nodeType === 3) continue;
		if (child.nodeType !== 1) {
			parent.removeChild(child);
			continue;
		}

		const element = child as Element;
		const tag = element.tagName.toLowerCase();

		if (DROP_WITH_CONTENT.has(tag)) {
			parent.removeChild(element);
			continue;
		}

		if (!allowedTags.has(tag)) {
			// Keep readable content from harmless unknown wrappers, but sanitize its children first.
			cleanChildren(element);
			while (element.firstChild) parent.insertBefore(element.firstChild, element);
			parent.removeChild(element);
			continue;
		}

		for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
		cleanChildren(element);
	}
};

const sanitizeDangerousMarkup = (html: string): string => {
	const tags = [...DROP_WITH_CONTENT].join("|");
	// Remove complete dangerous blocks first, then any stray opening/closing tags. This keeps the
	// inert DOMParser pass below from ever seeing a resource-bearing element (and from attempting
	// to load it in lightweight test DOMs). The DOM allowlist pass still validates the result.
	const stripped = html.replace(
		new RegExp(`<\\s*(${tags})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, "gi"),
		"",
	);
	return stripped.replace(new RegExp(`<\\s*\\/?\\s*(?:${tags})\\b[^>]*>`, "gi"), "");
};

const enforceAllowlist = (html: string): string => {
	const parsed = new DOMParser().parseFromString(sanitizeDangerousMarkup(html), "text/html");
	cleanChildren(parsed.body);
	return parsed.body.innerHTML;
};

export type SanitizedRichTextProps = {
	html: string;
	label: string;
};

/** A safe copy of stored rich text. It never writes the sanitized markup back to the document. */
export function SanitizedRichText({ html, label }: SanitizedRichTextProps) {
	const safeHtml = useMemo(() => sanitizeRichText(html), [html]);

	if (safeHtml.trim() === "") {
		return <p className="text-xs italic text-ink-3">No formatted content yet.</p>;
	}

	return (
		<figure
			data-rich-text-preview=""
			aria-label={label}
			className="m-0 mt-2 rounded-md border border-line bg-sunken/60 px-3 py-2 text-sm leading-6 text-ink-2 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_strong]:font-semibold [&_ul]:list-disc"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized twice with the formatting-only allowlist above.
			dangerouslySetInnerHTML={{ __html: safeHtml }}
		/>
	);
}
