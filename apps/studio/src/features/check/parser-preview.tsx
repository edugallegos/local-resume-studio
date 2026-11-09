import { cn } from "@reactive-resume/utils/style";
import type { CheckIssue } from "./issue-model";
import type { PdfCheckAnalysis } from "./pdf-check";

type RecognizedFieldId = "name" | "email" | "phone" | "location" | "links" | "headings" | "dates";

/** Which current Check issues concern which recognized field. Matching is by code, never by title. */
const FIELD_ISSUE_CODES: Readonly<Record<RecognizedFieldId, ReadonlySet<CheckIssue["code"]>>> = {
	name: new Set(["MISSING_NAME"]),
	email: new Set(["MISSING_EMAIL", "MALFORMED_EMAIL"]),
	phone: new Set(["MISSING_PHONE"]),
	location: new Set(["MISSING_LOCATION"]),
	links: new Set(["MALFORMED_URL"]),
	headings: new Set([
		"NON_STANDARD_SECTION_TITLE",
		"SECTION_MISSING_FROM_LAYOUT",
		"NO_VISIBLE_EXPERIENCE",
		"FRAGMENTED_ENTRY",
	]),
	dates: new Set([
		"EMPTY_PERIOD",
		"UNPARSEABLE_PERIOD",
		"UNPARSEABLE_DATE",
		"REVERSED_PERIOD",
		"FUTURE_DATED_PERIOD",
	]),
};

type RecognizedValue = { key: string; text: string };

const uniqueValues = (values: readonly string[]): RecognizedValue[] =>
	[...new Set(values.map((value) => value.trim()).filter(Boolean))].map((text) => ({ key: text, text }));

/** A one- or two-character value is too ambiguous to mark a line as evidence. */
const MIN_HIGHLIGHT_CHARACTERS = 3;

const highlightNeedle = (value: string | number | undefined): string | null => {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const needle = String(value).trim();
	return needle.replace(/\s+/g, "").length >= MIN_HIGHLIGHT_CHARACTERS ? needle : null;
};

function RecognizedField({
	id,
	label,
	values,
	issues,
}: {
	id: RecognizedFieldId;
	label: string;
	values: readonly RecognizedValue[];
	issues: readonly CheckIssue[];
}) {
	const matching = issues.filter((issue) => FIELD_ISSUE_CODES[id].has(issue.code));

	return (
		<div
			data-testid={`parser-field-${id}`}
			data-issue-codes={matching.length > 0 ? matching.map((issue) => issue.code).join(" ") : undefined}
		>
			<dt className="text-xs font-medium text-ink-3">{label}</dt>
			<dd className="mt-0.5 min-w-0 text-sm text-ink">
				{values.length === 0 ? (
					<span className="text-ink-3">Not found</span>
				) : (
					<ul className="flex flex-wrap gap-1">
						{values.map((value) => (
							<li
								key={value.key}
								className="max-w-full break-words rounded-sm bg-sunken px-1.5 py-0.5 text-xs text-ink-2"
							>
								{value.text}
							</li>
						))}
					</ul>
				)}
				{matching.length > 0 ? (
					<p className="mt-1 flex flex-wrap gap-1 text-[11px] font-medium text-warn-text">
						{matching.map((issue) => (
							<span key={issue.key} title={issue.title} className="rounded-sm bg-warn-soft px-1.5 py-0.5">
								{issue.code.replaceAll("_", " ")}
							</span>
						))}
					</p>
				) : null}
			</dd>
		</div>
	);
}

export type ParserPreviewProps = {
	/** The document and semantics extracted by the same local harvest that produced the report. */
	analysis: PdfCheckAnalysis;
	/** Current local Check issues, used only to mark recognized fields and matching text lines. */
	issues?: readonly CheckIssue[];
};

/**
 * Shows the pinned local extractor's recognized fields and text, grouped by page and already in
 * geometric reading order. It reports empty, truncated, and failed page reads honestly: a blank
 * view must never read as a successful blank resume.
 */
export function ParserPreview({ analysis, issues = [] }: ParserPreviewProps) {
	const { document, semantics, report, textReadFailed } = analysis;
	const hasText = document.fullText.trim().length > 0;
	const analyzedPages = document.pages.length;
	const totalPages = report.document.pageCount;
	const truncated = report.document.truncated;

	const headingLineIndices = new Set(semantics.headings.map((heading) => heading.lineIndex));
	const headingLines = new Set(document.lines.filter((_, index) => headingLineIndices.has(index)));

	// Only structured params.value is used: never a title or a guessed snippet. A line is marked
	// when the exact value the finding names occurs in the pinned extractor's text for it.
	const highlightEntries = issues.flatMap((issue) => {
		const needle = highlightNeedle(issue.params?.value);
		return needle ? [{ issue, needle }] : [];
	});

	const headingValues: RecognizedValue[] = semantics.headings.map((heading) => ({
		key: `${heading.page}:${heading.lineIndex}:${heading.text}`,
		text: heading.text,
	}));

	const fields: { id: RecognizedFieldId; label: string; values: RecognizedValue[] }[] = [
		{
			id: "name",
			label: "Name",
			values: uniqueValues(semantics.contact.nameLine ? [semantics.contact.nameLine] : []),
		},
		{ id: "email", label: "Email", values: uniqueValues(semantics.contact.emails) },
		{ id: "phone", label: "Phone", values: uniqueValues(semantics.contact.phones) },
		{
			id: "location",
			label: "Location",
			values: uniqueValues(semantics.contact.locationLine ? [semantics.contact.locationLine] : []),
		},
		{
			id: "links",
			label: "Links",
			values: uniqueValues([...semantics.contact.textUrls, ...semantics.contact.annotationUrls]),
		},
		{ id: "headings", label: "Section headings", values: headingValues },
		{ id: "dates", label: "Dates", values: uniqueValues(semantics.dates.map((date) => date.raw)) },
	];

	return (
		<div className="flex w-full min-w-0 flex-col gap-3" data-testid="parser-preview">
			<div className="rounded-md border border-line bg-surface px-3 py-2 text-xs leading-5 text-ink-2">
				<p className="font-semibold text-ink">What this local parser reads</p>
				<p className="mt-1">
					This view shows the fields and text this local parser extracted from the analyzed PDF. Other ATS
					products may read the same file differently, so it cannot guarantee how any particular ATS will
					behave.
				</p>
			</div>

			{truncated ? (
				<p
					role="status"
					data-testid="parser-truncated"
					className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs leading-5 text-warn-text"
				>
					Only the first {analyzedPages} of {totalPages} pages were analyzed. Later pages are not shown here.
				</p>
			) : null}

			{textReadFailed ? (
				<div
					role="alert"
					data-testid="parser-read-failed"
					className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-text"
				>
					At least one page&apos;s text could not be read. Missing text below may be a read failure rather than
					an empty page.
				</div>
			) : null}

			<section
				aria-labelledby="parser-recognized-title"
				data-testid="parser-recognized"
				className="rounded-md border border-line bg-surface p-3"
			>
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h3 id="parser-recognized-title" className="text-sm font-semibold text-ink">
						Recognized fields
					</h3>
					<p className="text-xs text-ink-3">From this local parser</p>
				</div>
				<dl className="mt-2 grid gap-2 sm:grid-cols-2">
					{fields.map((field) => (
						<RecognizedField
							key={field.id}
							id={field.id}
							label={field.label}
							values={field.values}
							issues={issues}
						/>
					))}
				</dl>
			</section>

			{hasText ? (
				<>
					<div className="flex flex-col gap-3">
						{document.pages.map((page) => {
							const headingId = `parser-page-heading-${page.pageNumber}`;
							return (
								<section
									key={page.pageNumber}
									aria-labelledby={headingId}
									data-testid={`parser-page-${page.pageNumber}`}
									className="rounded-md border border-line bg-white p-3"
								>
									<h3
										id={headingId}
										className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-3"
									>
										Page {page.pageNumber}
									</h3>
									{page.lines.length === 0 ? (
										<p className="mt-2 text-sm text-ink-3">No text on this page.</p>
									) : (
										<div className="mt-2 flex flex-col gap-1">
											{page.lines.map((line) => {
												const heading = headingLines.has(line);
												const matchingIssues = highlightEntries
													.filter(({ needle }) =>
														line.text.toLowerCase().includes(needle.toLowerCase()),
													)
													.map(({ issue }) => issue);
												const highlighted = matchingIssues.length > 0;

												return (
													<p
														// Geometry identifies a line even when the text repeats on the page.
														key={`${line.page}:${line.x}:${line.y}:${line.meanStreamIndex}:${line.text}`}
														dir="auto"
														data-recognized-heading={heading ? "true" : undefined}
														data-highlighted={highlighted ? "true" : undefined}
														data-issue-codes={
															highlighted
																? matchingIssues.map((issue) => issue.code).join(" ")
																: undefined
														}
														className={cn(
															"break-words whitespace-pre-wrap text-sm leading-6",
															heading && "font-semibold",
															highlighted
																? "rounded-sm border-l-2 border-warn bg-warn-soft px-2 text-warn-text"
																: heading
																	? "rounded-sm bg-accent-soft/60 px-1 text-accent-text"
																	: "text-ink",
														)}
													>
														{line.text}
														{heading ? (
															<span className="sr-only"> (recognized section heading)</span>
														) : null}
														{highlighted ? (
															<span className="sr-only">
																{" "}
																Flagged by {matchingIssues.map((issue) => issue.code).join(", ")}
															</span>
														) : null}
													</p>
												);
											})}
										</div>
									)}
								</section>
							);
						})}
					</div>
					<p className="text-xs text-ink-3">
						{document.wordCount} {document.wordCount === 1 ? "word" : "words"} across {analyzedPages} analyzed{" "}
						{analyzedPages === 1 ? "page" : "pages"}.
					</p>
				</>
			) : (
				<div
					role="status"
					data-testid="parser-empty"
					className="rounded-md border border-line bg-sunken/40 px-3 py-4 text-sm leading-6 text-ink-2"
				>
					<p className="font-semibold text-ink">No text was recovered from this PDF.</p>
					<p className="mt-1">
						{textReadFailed
							? "The parser failed to read at least one page, so this empty result may not mean the resume has no text."
							: "A parser may see an empty resume even though the pages look fine. Check that the PDF has a real text layer rather than only an image."}
					</p>
				</div>
			)}
		</div>
	);
}
