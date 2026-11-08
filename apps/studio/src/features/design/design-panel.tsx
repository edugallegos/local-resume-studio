import type { EntryHeader, ResumeData } from "@reactive-resume/schema/resume/data";
import { entryHeaderAccents, entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { type Template, templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from "react";
import {
	DENSITY_PRESETS,
	type DesignDensity,
	MARGIN_PRESETS,
	type MarginPreset,
	type ResumeEdit,
} from "../write/resume-edits";
import { AdvancedGroup } from "./advanced-group";
import {
	ACCENTS,
	contrastRatio,
	darkenForWhite,
	hexToRgba,
	normalizeHex,
	rgbaToHex,
} from "./design-color";
import { fieldClass, NumberInput } from "./design-ui";
import { PageLayout } from "./page-layout";
import { SECTION_LABELS } from "./section-labels";
import {
	templateDisplayName,
	templateSampleImage,
	type TemplateThumbnailDependencies,
	useTemplateThumbnail,
} from "./template-thumbnail";

export { DENSITY_PRESETS, SECTION_LABELS };

export type FontPairing = { id: string; label: string; body: string; heading: string };

/** Catalog families only: each pairing writes `metadata.typography.*.fontFamily`. */
export const FONT_PAIRINGS: FontPairing[] = [
	{ id: "plex-serif", label: "IBM Plex Serif · serif", body: "IBM Plex Serif", heading: "IBM Plex Serif" },
	{ id: "inter", label: "Inter · sans", body: "Inter", heading: "Inter" },
	{ id: "source", label: "Source Sans 3 + Source Serif 4", body: "Source Sans 3", heading: "Source Serif 4" },
	{ id: "plex-sans-serif", label: "IBM Plex Sans + IBM Plex Serif", body: "IBM Plex Sans", heading: "IBM Plex Serif" },
	{ id: "lato-playfair", label: "Lato + Playfair Display", body: "Lato", heading: "Playfair Display" },
	{ id: "garamond", label: "EB Garamond · serif", body: "EB Garamond", heading: "EB Garamond" },
	{ id: "work-sans", label: "Work Sans · sans", body: "Work Sans", heading: "Work Sans" },
	{ id: "merriweather", label: "Merriweather · serif", body: "Merriweather", heading: "Merriweather" },
	{ id: "roboto-slab", label: "Roboto + Roboto Slab", body: "Roboto", heading: "Roboto Slab" },
];

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export type DesignPanelProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
	/** Ephemeral, not an edit: the shell swaps the preview template and restores it when cleared. */
	onPreviewTemplate?: (template: Template | null) => void;
	/** Tests can skip real PDF thumbnail rendering; production keeps it enabled. */
	thumbnailsEnabled?: boolean;
	thumbnailDependencies?: TemplateThumbnailDependencies;
	/** Physical pages in the last completed applied PDF render; null until one arrives. */
	renderedPages?: number | null;
	fitRunning?: boolean;
	fitMessage?: string | null;
	onFit?: () => void;
};

export type TemplateFilter = "all" | "one" | "two" | "ats";

export const TEMPLATE_FILTERS: { id: TemplateFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "one", label: "One column" },
	{ id: "two", label: "Two columns" },
	{ id: "ats", label: "ATS-safe" },
];

/** The single source for gallery filtering, mirroring the pinned template layout metadata. */
export const templateMatchesFilter = (template: Template, filter: TemplateFilter): boolean => {
	const layout = templateLayouts[template];
	if (filter === "one") return layout.columns === 1;
	if (filter === "two") return layout.columns === 2;
	if (filter === "ats") return layout.atsSafe;
	return true;
};

export const templateLayoutTags = (template: Template): string => {
	const layout = templateLayouts[template];
	const tags = [layout.columns === 1 ? "One column" : "Two columns"];
	if (layout.atsSafe) tags.push("ATS-safe");
	return tags.join(" · ");
};

/** Touch has no hover: holding a card this long previews it instead of applying it. */
const HOLD_TO_PREVIEW_MS = 400;

function useInView(ref: RefObject<HTMLElement | null>, rootMargin = "240px"): boolean {
	const [inView, setInView] = useState(false);

	useEffect(() => {
		if (inView) return;
		const node = ref.current;
		// A host without IntersectionObserver (tests, older browsers) simply renders the card's thumbnail.
		if (!node || typeof IntersectionObserver === "undefined") {
			setInView(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setInView(true);
					observer.disconnect();
				}
			},
			{ rootMargin },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [inView, ref, rootMargin]);

	return inView;
}

type TemplateCardProps = {
	template: Template;
	data: ResumeData;
	selected: boolean;
	thumbnailsEnabled: boolean;
	thumbnailDependencies?: TemplateThumbnailDependencies;
	onPreview: () => void;
	onClearPreview: () => void;
	onApply: () => void;
};

function TemplateCard({
	template,
	data,
	selected,
	thumbnailsEnabled,
	thumbnailDependencies,
	onPreview,
	onClearPreview,
	onApply,
}: TemplateCardProps) {
	const ref = useRef<HTMLButtonElement | null>(null);
	const inView = useInView(ref);
	const { url } = useTemplateThumbnail({
		data,
		template,
		enabled: thumbnailsEnabled && inView,
		dependencies: thumbnailDependencies,
	});
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const sampleImage = templateSampleImage(template);
	const imageSource = url && failedUrl !== url ? url : sampleImage;
	const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; previewing: boolean }>({ previewing: false });

	const endHold = () => {
		if (hold.current.timer) clearTimeout(hold.current.timer);
		if (hold.current.previewing) onClearPreview();
	};

	return (
		<button
			ref={ref}
			type="button"
			data-template-id={template}
			aria-pressed={selected}
			aria-label={`${templateDisplayName(template)} template, ${templateLayoutTags(template)}`}
			onPointerEnter={(event) => {
				if (event.pointerType !== "touch") onPreview();
			}}
			onPointerDown={(event) => {
				if (event.pointerType !== "touch") return;
				hold.current.previewing = false;
				hold.current.timer = setTimeout(() => {
					hold.current.previewing = true;
					onPreview();
				}, HOLD_TO_PREVIEW_MS);
			}}
			onPointerUp={endHold}
			onPointerCancel={() => {
				endHold();
				onClearPreview();
			}}
			onPointerLeave={() => {
				if (hold.current.previewing) endHold();
			}}
			// A long press shows the preview; it doesn't open the system menu or apply the template.
			onContextMenu={(event) => event.preventDefault()}
			onFocus={onPreview}
			onClick={() => {
				if (hold.current.previewing) {
					hold.current.previewing = false;
					return;
				}
				onApply();
			}}
			className="group/card grid min-w-0 gap-1.5 rounded-lg text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
		>
			<span
				className={cn(
					"relative block aspect-[210/297] overflow-hidden rounded-md border border-line bg-white shadow-e1 transition-transform duration-quick group-hover/card:-translate-y-0.5",
					selected && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
				)}
			>
				<img
					src={imageSource}
					alt=""
					loading="lazy"
					onError={() => setFailedUrl(imageSource)}
					className="size-full object-cover object-top"
				/>
				{selected ? (
					<span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-sm bg-accent text-on-accent">
						<Icon name="check" size={14} />
					</span>
				) : null}
			</span>
			<span className="truncate text-sm font-medium leading-4 text-ink">{templateDisplayName(template)}</span>
			<span className="text-xs leading-4 text-ink-3">{templateLayoutTags(template)}</span>
		</button>
	);
}

function DesignGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<section id={`design-${id}`} aria-labelledby={`design-${id}-title`} className="flex flex-col gap-3">
			<h2 id={`design-${id}-title`} className="text-sm font-semibold text-ink">
				{title}
			</h2>
			{children}
		</section>
	);
}

/** One line of a layout wireframe: dark for the lead, light for the rest, accent for an eyebrow. */
function Bar({ tone, className }: { tone?: "lead" | "accent"; className: string }) {
	return (
		<span
			className={cn(
				"block h-1 rounded-sm",
				tone === "lead" ? "bg-ink" : tone === "accent" ? "h-[3px] bg-accent" : "bg-line-2",
				className,
			)}
		/>
	);
}

const ROW = "flex items-center justify-between gap-0.5";

const ENTRY_LAYOUTS: {
	id: EntryHeader["layout"];
	label: string;
	wireframe: ReactNode;
}[] = [
	{
		id: "stacked",
		label: "Stacked",
		wireframe: (
			<>
				<span className={ROW}>
					<Bar tone="lead" className="w-[46%]" />
					<Bar className="w-[22%]" />
				</span>
				<span className={ROW}>
					<Bar className="w-[38%]" />
					<Bar className="w-[28%]" />
				</span>
			</>
		),
	},
	{
		id: "inline",
		label: "One line",
		wireframe: (
			<span className={ROW}>
				<span className="flex w-[68%] gap-0.5">
					<Bar tone="lead" className="w-[45%]" />
					<Bar className="w-[30%]" />
					<Bar className="w-[18%]" />
				</span>
				<Bar className="w-[22%]" />
			</span>
		),
	},
	{
		id: "compact",
		label: "Compact",
		wireframe: (
			<>
				<span className={ROW}>
					<Bar tone="lead" className="w-[52%]" />
					<Bar className="w-[26%]" />
				</span>
				<span className="flex gap-0.5">
					<Bar className="w-[30%]" />
					<Bar className="w-[16%]" />
				</span>
			</>
		),
	},
	{
		id: "date-column",
		label: "Date column",
		wireframe: (
			<span className="flex items-center gap-1">
				<Bar className="w-[24%] shrink-0" />
				<span className="grid flex-1 gap-1">
					<Bar tone="lead" className="w-[80%]" />
					<Bar className="w-[58%]" />
				</span>
			</span>
		),
	},
	{
		id: "eyebrow",
		label: "Eyebrow",
		wireframe: (
			<>
				<Bar tone="accent" className="w-[40%]" />
				<span className={ROW}>
					<Bar tone="lead" className="h-[5px] w-[58%]" />
					<Bar className="w-[24%]" />
				</span>
			</>
		),
	},
];

function ColorGroup({ data, onEdit }: { data: ResumeData; onEdit: (edit: ResumeEdit) => void }) {
	const current = rgbaToHex(data.metadata.design.colors.primary) ?? "#000000";
	const [typed, setTyped] = useState<string | null>(null);
	const hex = typed ?? current;
	const normalized = normalizeHex(hex);
	const valid = normalized !== null;
	const ratio = valid ? contrastRatio(normalized) : 1;
	const tooLight = valid && ratio < 4.5;

	const setAccent = (next: string) => {
		setTyped(null);
		onEdit({ type: "update-accent", color: hexToRgba(next) });
	};

	return (
		<div className="flex flex-col gap-3">
			<fieldset aria-label="Accent swatches" className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
				{ACCENTS.map((accent) => (
					<button
						key={accent.hex}
						type="button"
						aria-label={accent.label}
						aria-pressed={normalized === accent.hex}
						title={accent.label}
						onClick={() => setAccent(accent.hex)}
						className={cn(
							"size-8 rounded-sm border border-line-2",
							normalized === accent.hex && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
						)}
						style={{ backgroundColor: accent.hex }}
					/>
				))}
			</fieldset>

			<div className="grid gap-2 sm:grid-cols-2">
				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Accent color
					<input
						type="color"
						aria-label="Accent color"
						className="h-9 w-12 rounded-sm border border-line-2 bg-surface"
						value={normalized ?? current}
						onChange={(event) => setAccent(event.target.value)}
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Custom color (hex)
					<input
						className={cn(fieldClass, "font-mono")}
						value={hex}
						spellCheck={false}
						aria-invalid={!valid}
						aria-describedby={valid ? undefined : "design-accent-hex-error"}
						onChange={(event) => {
							const value = event.target.value;
							setTyped(value);
							const next = normalizeHex(value);
							if (next) onEdit({ type: "update-accent", color: hexToRgba(next) });
						}}
						onBlur={() => setTyped(null)}
					/>
				</label>
			</div>

			{!valid ? (
				<p id="design-accent-hex-error" className="text-xs text-danger-text">
					Use a hex color such as #2F5A8A.
				</p>
			) : null}

			{valid ? (
				<p className={cn("font-mono text-xs", tooLight ? "text-warn-text" : "text-ink-3")}>
					{ratio.toFixed(1)}:1 contrast on white
				</p>
			) : null}

			{tooLight ? (
				<div
					role="status"
					className="flex flex-wrap items-center gap-3 rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs text-warn-text"
				>
					<span>Too light for headings on white. It may be hard to read and print faintly.</span>
					<button
						type="button"
						className="rounded-sm border border-line-2 px-2 py-1 text-ink-2 hover:bg-hover"
						onClick={() => setAccent(darkenForWhite(normalized))}
					>
						Use a darker shade
					</button>
				</div>
			) : null}

			<p className="text-xs leading-5 text-ink-3">
				Accent is used for headings, icons, and the header band. Body text stays near-black for print and ATS.
			</p>
		</div>
	);
}

function PageStatus({
	data,
	renderedPages,
	fitRunning,
	fitMessage,
	onEdit,
	onFit,
}: {
	data: ResumeData;
	renderedPages: number | null;
	fitRunning: boolean;
	fitMessage: string | null;
	onEdit: (edit: ResumeEdit) => void;
	onFit?: (() => void) | undefined;
}) {
	const authored = Math.max(1, data.metadata.layout.pages.length);
	const overflowing = renderedPages !== null && renderedPages > authored;
	const label = `${authored} authored ${authored === 1 ? "page" : "pages"}`;

	return (
		<section
			aria-label="Page overflow status"
			className={cn(
				"flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs",
				overflowing ? "border-warn bg-warn-soft text-warn-text" : "border-line bg-sunken text-ink-2",
			)}
		>
			<span aria-live="polite" className="flex-1">
				{renderedPages === null
					? "Waiting for the first completed PDF render."
					: overflowing
						? `Your resume runs to ${renderedPages} pages; ${label}.`
						: `Fits within ${label}.`}
				{fitMessage ? <span className="ms-2 font-medium">{fitMessage}</span> : null}
			</span>
			<button
				type="button"
				className="rounded-sm border border-line-2 px-2 py-1 text-ink-2 hover:bg-hover"
				onClick={() => onEdit({ type: "add-page" })}
			>
				Add page
			</button>
			<button
				type="button"
				aria-label={`Fit content to ${authored} authored ${authored === 1 ? "page" : "pages"}`}
				className="rounded-sm border border-line-2 px-2 py-1 text-ink-2 hover:bg-hover disabled:opacity-40"
				disabled={!overflowing || fitRunning || !onFit}
				onClick={onFit}
			>
				{fitRunning ? "Fitting…" : "Fit"}
			</button>
		</section>
	);
}

/**
 * Local design controls. Every control dispatches a named edit; `editResume` writes only the supported
 * ResumeData paths, so unsupported imported fields and custom sections survive untouched.
 */
export function DesignPanel({
	data,
	onEdit,
	onPreviewTemplate,
	thumbnailsEnabled = true,
	thumbnailDependencies,
	renderedPages = null,
	fitRunning = false,
	fitMessage = null,
	onFit,
}: DesignPanelProps) {
	const [filter, setFilter] = useState<TemplateFilter>("all");
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const onPreviewTemplateRef = useRef(onPreviewTemplate);
	onPreviewTemplateRef.current = onPreviewTemplate;

	useEffect(() => {
		// Leaving Design (or unmounting the panel) never leaves a temporary template on the page.
		return () => onPreviewTemplateRef.current?.(null);
	}, []);

	const entry = entryHeaderOf(data.metadata.design);
	const density =
		(Object.entries(DENSITY_PRESETS) as [DesignDensity, (typeof DENSITY_PRESETS)[DesignDensity]][]).find(
			([, preset]) => preset.gapX === data.metadata.page.gapX && preset.gapY === data.metadata.page.gapY,
		)?.[0] ?? "custom";
	const marginPreset =
		(Object.entries(MARGIN_PRESETS) as [MarginPreset, (typeof MARGIN_PRESETS)[MarginPreset]][]).find(
			([, preset]) =>
				preset.marginX === data.metadata.page.marginX &&
				preset.marginY === data.metadata.page.marginY,
		)?.[0] ?? "custom";
	const pairing =
		FONT_PAIRINGS.find(
			(candidate) =>
				candidate.body === data.metadata.typography.body.fontFamily &&
				candidate.heading === data.metadata.typography.heading.fontFamily,
		)?.id ?? "custom";

	const shownTemplates = useMemo(
		() => templateSchema.options.filter((template) => templateMatchesFilter(template, filter)),
		[filter],
	);

	const previewTemplate = (template: Template) => {
		// Previewing the template already in use restores the applied page rather than rendering a duplicate.
		onPreviewTemplate?.(template === data.metadata.template ? null : template);
	};

	const clearPreview = () => onPreviewTemplate?.(null);

	const applyTemplate = (template: Template) => {
		onPreviewTemplate?.(null);
		if (template === data.metadata.template) return;
		onEdit({ type: "update-template", template });
	};

	const onGalleryBlur = (event: FocusEvent<HTMLFieldSetElement>) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearPreview();
	};

	const onGalleryKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		clearPreview();
	};

	const jumpTo = (id: string) => {
		if (id === "advanced") {
			setAdvancedOpen(true);
			// Wait for the collapsed contents to mount before aiming at them.
			setTimeout(() => document.getElementById("design-advanced")?.scrollIntoView?.({ block: "start" }), 0);
			return;
		}
		document.getElementById(`design-${id}`)?.scrollIntoView?.({ block: "start" });
	};

	const groups = [
		{ id: "template", label: "Template" },
		{ id: "entries", label: "Entries" },
		{ id: "type", label: "Type" },
		{ id: "color", label: "Color" },
		{ id: "page", label: "Page" },
		{ id: "advanced", label: "Advanced" },
	];

	return (
		<div className="flex flex-col gap-6">
			<p className="text-sm leading-6 text-ink-2">
				Visual choices write only the supported v6.1.0 design fields. The saved JSON stays as it is until you choose
				Save changes.
			</p>

			<nav aria-label="Design groups" className="flex flex-wrap gap-1.5 border-b border-line pb-2">
				{groups.map((group) => (
					<button
						key={group.id}
						type="button"
						aria-expanded={group.id === "advanced" ? advancedOpen : undefined}
						aria-controls={group.id === "advanced" ? "design-advanced" : undefined}
						onClick={() => jumpTo(group.id)}
						className="h-8 rounded-sm px-3 text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
					>
						{group.label}
					</button>
				))}
			</nav>

			<DesignGroup id="template" title="Template">
				<p className="text-xs leading-5 text-ink-3">
					Hover or focus a card to preview it on the live page. Click to apply it to this in-memory draft.
				</p>

				<div className="flex flex-wrap items-center gap-1.5">
					{TEMPLATE_FILTERS.map((option) => {
						const active = option.id === filter;
						return (
							<button
								key={option.id}
								type="button"
								aria-pressed={active}
								onClick={() => setFilter(option.id)}
								className={cn(
									"flex h-7 items-center rounded-sm border px-3 text-[13px] transition-colors",
									active
										? "border-accent bg-accent-soft font-medium text-accent-text"
										: "border-line-2 text-ink-2 hover:bg-hover",
								)}
							>
								{option.label}
							</button>
						);
					})}
					<span className="ms-auto text-xs text-ink-3">
						{shownTemplates.length} of {templateSchema.options.length} shown
					</span>
				</div>

				<fieldset
					aria-label="Template gallery"
					className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0 sm:grid-cols-3"
					onPointerLeave={clearPreview}
					onBlur={onGalleryBlur}
					onKeyDown={onGalleryKeyDown}
				>
					{shownTemplates.map((template) => (
						<TemplateCard
							key={template}
							template={template}
							data={data}
							selected={template === data.metadata.template}
							thumbnailsEnabled={thumbnailsEnabled}
							thumbnailDependencies={thumbnailDependencies}
							onPreview={() => previewTemplate(template)}
							onClearPreview={clearPreview}
							onApply={() => applyTemplate(template)}
						/>
					))}
				</fieldset>
			</DesignGroup>

			<DesignGroup id="entries" title="Entries">
				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<span className="text-xs font-medium text-ink-2">Header layout</span>
						<span className="text-xs text-ink-3">Experience, Education, and more</span>
					</div>
					<fieldset aria-label="Header layout" className="m-0 grid grid-cols-2 gap-1.5 border-0 p-0 sm:grid-cols-3">
						{ENTRY_LAYOUTS.map((option) => (
							<button
								key={option.id}
								type="button"
								aria-label={`${option.label} entry layout`}
								aria-pressed={entry.layout === option.id}
								onClick={() =>
									onEdit({ type: "update-entry-layout", changes: { layout: option.id } })
								}
								className={cn(
									"group/layout grid content-start gap-1.5 rounded-md border border-line bg-surface px-1.5 pb-1 pt-1.5 text-start transition-colors hover:bg-hover",
									entry.layout === option.id && "border-accent ring-1 ring-accent",
								)}
							>
								<span
									data-entry-wireframe={option.id}
									aria-hidden="true"
									className="flex h-7 flex-col justify-center gap-1 px-0.5"
								>
									{option.wireframe}
								</span>
								<span className="text-center text-xs leading-4 text-ink-2">{option.label}</span>
							</button>
						))}
					</fieldset>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Entry lead
						<select
							className={fieldClass}
							value={entry.lead}
							onChange={(event) =>
								onEdit({
									type: "update-entry-layout",
									changes: { lead: event.target.value as EntryHeader["lead"] },
								})
							}
						>
							<option value="organization">Organization first</option>
							<option value="role">Role first</option>
						</select>
					</label>
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Entry accent
						<select
							className={fieldClass}
							value={entry.accent}
							onChange={(event) =>
								onEdit({
									type: "update-entry-layout",
									changes: { accent: event.target.value as EntryHeader["accent"] },
								})
							}
						>
							{entryHeaderAccents.map((accentName) => (
								<option key={accentName} value={accentName}>
									{titleCase(accentName)}
								</option>
							))}
						</select>
					</label>
				</div>
			</DesignGroup>

			<DesignGroup id="type" title="Type">
				<div className="grid gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Font pairing
						<select
							className={fieldClass}
							value={pairing}
							onChange={(event) => {
								const chosen = FONT_PAIRINGS.find(
									(candidate) => candidate.id === event.target.value,
								);
								if (chosen) {
									onEdit({
										type: "update-font-pairing",
										body: chosen.body,
										heading: chosen.heading,
									});
								}
							}}
						>
							{pairing === "custom" ? (
								<option value="custom" disabled>
									Custom pairing
								</option>
							) : null}
							{FONT_PAIRINGS.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>
									{candidate.label}
								</option>
							))}
						</select>
					</label>

					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Text size
						<NumberInput
							label="Text size"
							min={6}
							max={24}
							step={0.5}
							value={data.metadata.typography.body.fontSize}
							onValueChange={(bodySize) => onEdit({ type: "update-text-size", bodySize })}
						/>
						<span className="text-xs font-normal text-ink-3">10–11 pt recommended</span>
					</div>

					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Density
						<select
							className={fieldClass}
							value={density}
							onChange={(event) =>
								onEdit({
									type: "update-density",
									density: event.target.value as DesignDensity,
								})
							}
						>
							{density === "custom" ? (
								<option value="custom" disabled>
									Custom spacing
								</option>
							) : null}
							{Object.keys(DENSITY_PRESETS).map((preset) => (
								<option key={preset} value={preset}>
									{titleCase(preset)}
								</option>
							))}
						</select>
					</label>
				</div>
			</DesignGroup>

			<DesignGroup id="color" title="Color">
				<ColorGroup data={data} onEdit={onEdit} />
			</DesignGroup>

			<DesignGroup id="page" title="Page">
				<div className="grid gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Page size
						<select
							className={fieldClass}
							value={data.metadata.page.format}
							onChange={(event) =>
								onEdit({
									type: "update-page",
									changes: { format: event.target.value as "a4" | "letter" },
								})
							}
						>
							<option value="a4">A4</option>
							<option value="letter">Letter</option>
						</select>
					</label>

					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Margins
						<fieldset aria-label="Margins" className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
							{(Object.entries(MARGIN_PRESETS) as [MarginPreset, (typeof MARGIN_PRESETS)[MarginPreset]][]).map(
								([preset, values]) => (
									<button
										key={preset}
										type="button"
										aria-pressed={marginPreset === preset}
										onClick={() =>
											onEdit({
												type: "update-page",
												changes: {
													marginX: values.marginX,
													marginY: values.marginY,
												},
											})
										}
										className={cn(
											"h-7 rounded-sm border px-2.5 text-xs capitalize",
											marginPreset === preset
												? "border-accent bg-accent-soft font-medium text-accent-text"
												: "border-line-2 text-ink-2 hover:bg-hover",
										)}
									>
										{preset}
									</button>
								),
							)}
						</fieldset>
					</div>

					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Horizontal margin
						<NumberInput
							label="Horizontal margin"
							min={0}
							max={100}
							value={data.metadata.page.marginX}
							onValueChange={(marginX) => onEdit({ type: "update-page", changes: { marginX } })}
						/>
						</div>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Vertical margin
						<NumberInput
							label="Vertical margin"
							min={0}
							max={100}
							value={data.metadata.page.marginY}
							onValueChange={(marginY) => onEdit({ type: "update-page", changes: { marginY } })}
						/>
						</div>
				</div>

				<PageStatus
					data={data}
					renderedPages={renderedPages}
					fitRunning={fitRunning}
					fitMessage={fitMessage}
					onEdit={onEdit}
					onFit={onFit}
				/>

				<div className="flex flex-col gap-2">
					<h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">
						Pages and sections
					</h3>
					<PageLayout data={data} onEdit={onEdit} showAddPage={false} />
				</div>
			</DesignGroup>

			<section id="design-advanced" aria-labelledby="design-advanced-title" className="flex flex-col gap-3">
				<h2 id="design-advanced-title" className="text-sm font-semibold text-ink">
					Advanced
				</h2>
				{advancedOpen ? <AdvancedGroup data={data} onEdit={onEdit} /> : null}
			</section>
		</div>
	);
}
