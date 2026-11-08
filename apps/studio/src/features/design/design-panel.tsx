import type { EntryHeader, ResumeData } from "@reactive-resume/schema/resume/data";
import { entryHeaderAccents, entryHeaderLayouts, entryHeaderOf } from "@reactive-resume/schema/resume/data";
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
	type RefObject,
} from "react";
import {
	DENSITY_PRESETS,
	type DesignDensity,
	displayedSectionIds,
	type LayoutColumn,
	type ResumeEdit,
} from "../write/resume-edits";
import {
	templateDisplayName,
	templateSampleImage,
	type TemplateThumbnailDependencies,
	useTemplateThumbnail,
} from "./template-thumbnail";

export { DENSITY_PRESETS };

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

/** The persistent sections a resume can show, by schema key. */
export const SECTION_LABELS = {
	summary: "Summary",
	profiles: "Profiles",
	experience: "Experience",
	education: "Education",
	projects: "Projects",
	skills: "Skills",
	languages: "Languages",
	interests: "Interests",
	awards: "Awards",
	certifications: "Certifications",
	publications: "Publications",
	volunteer: "Volunteer",
	references: "References",
} as const;

type SectionEntry = { id: string; label: string; hidden: boolean };

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const parseRgba = (value: string): { r: number; g: number; b: number } | null => {
	const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
	if (!match) return null;
	return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
};

const toHex = (value: string): string => {
	const color = parseRgba(value);
	if (!color) return "#000000";
	const component = (channel: number) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0");
	return `#${component(color.r)}${component(color.g)}${component(color.b)}`;
};

const fromHex = (value: string): string => {
	const match = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) return value;
	return `rgba(${Number.parseInt(match[1] ?? "0", 16)}, ${Number.parseInt(match[2] ?? "0", 16)}, ${Number.parseInt(match[3] ?? "0", 16)}, 1)`;
};

const numberValue = (value: string, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export type DesignPanelProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
	/** Ephemeral, not an edit: the shell swaps the preview template and restores it when cleared. */
	onPreviewTemplate?: (template: Template | null) => void;
	/** Tests can skip real PDF thumbnail rendering; production keeps it enabled. */
	thumbnailsEnabled?: boolean;
	thumbnailDependencies?: TemplateThumbnailDependencies;
};

const fieldClass =
	"w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-sm text-ink shadow-none focus-visible:outline-2 focus-visible:outline-accent";

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

function SectionList({
	title,
	column,
	entries,
	onEdit,
}: {
	title: string;
	column: LayoutColumn;
	entries: SectionEntry[];
	onEdit: (edit: ResumeEdit) => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-sunken/40 p-3">
			<h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</h3>
			{entries.length === 0 ? <p className="text-xs text-ink-3">No sections in this column.</p> : null}
			<ol className="flex flex-col gap-1.5">
				{entries.map((entry, index) => (
					<li
						key={entry.id}
						className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface px-2 py-1.5"
					>
						<label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
							<input
								type="checkbox"
								aria-label={`Show ${entry.label}`}
								checked={!entry.hidden}
								onChange={(event) =>
									onEdit({ type: "set-section-visibility", sectionId: entry.id, hidden: !event.target.checked })
								}
							/>
							<span className="truncate">{entry.label}</span>
						</label>
						<div className="flex items-center gap-1">
							<button
								type="button"
								className="rounded-sm border border-line-2 px-1.5 py-0.5 text-xs text-ink-2 disabled:opacity-40"
								aria-label={`Move ${entry.label} up`}
								disabled={index === 0}
								onClick={() => onEdit({ type: "move-section", sectionId: entry.id, column, direction: "up" })}
							>
								↑
							</button>
							<button
								type="button"
								className="rounded-sm border border-line-2 px-1.5 py-0.5 text-xs text-ink-2 disabled:opacity-40"
								aria-label={`Move ${entry.label} down`}
								disabled={index === entries.length - 1}
								onClick={() => onEdit({ type: "move-section", sectionId: entry.id, column, direction: "down" })}
							>
								↓
							</button>
							<button
								type="button"
								className="rounded-sm border border-line-2 px-1.5 py-0.5 text-xs text-ink-2"
								aria-label={`Move ${entry.label} to ${column === "main" ? "sidebar" : "main"}`}
								onClick={() =>
									onEdit({
										type: "move-section-to-column",
										sectionId: entry.id,
										column: column === "main" ? "sidebar" : "main",
									})
								}
							>
								{column === "main" ? "→" : "←"}
							</button>
						</div>
					</li>
				))}
			</ol>
		</div>
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
}: DesignPanelProps) {
	const [filter, setFilter] = useState<TemplateFilter>("all");
	const onPreviewTemplateRef = useRef(onPreviewTemplate);
	onPreviewTemplateRef.current = onPreviewTemplate;

	useEffect(() => {
		// Leaving Design (or unmounting the panel) never leaves a temporary template on the page.
		return () => onPreviewTemplateRef.current?.(null);
	}, []);

	const entry = entryHeaderOf(data.metadata.design);
	const accent = toHex(data.metadata.design.colors.primary);
	const density =
		(Object.entries(DENSITY_PRESETS) as [DesignDensity, (typeof DENSITY_PRESETS)[DesignDensity]][]).find(
			([, preset]) => preset.gapX === data.metadata.page.gapX && preset.gapY === data.metadata.page.gapY,
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

	const sections = useMemo(() => {
		const known = new Map<string, SectionEntry>();
		for (const [id, label] of Object.entries(SECTION_LABELS)) {
			if (id === "summary") {
				known.set(id, { id, label: data.summary.title || label, hidden: data.summary.hidden });
				continue;
			}
			const section = (data.sections as Record<string, { title: string; hidden: boolean } | undefined>)[id];
			if (!section) continue;
			known.set(id, { id, label: section.title || label, hidden: section.hidden });
		}
		for (const custom of data.customSections) {
			known.set(custom.id, {
				id: custom.id,
				label: custom.title || "Custom section",
				hidden: custom.hidden,
			});
		}

		const byId = (id: string) => known.get(id);
		const main = displayedSectionIds(data, "main").flatMap((id) => {
			const section = byId(id);
			return section ? [section] : [];
		});
		const sidebar = displayedSectionIds(data, "sidebar").flatMap((id) => {
			const section = byId(id);
			return section ? [section] : [];
		});
		return { main, sidebar };
	}, [data]);

	return (
		<div className="flex flex-col gap-6">
			<p className="text-sm leading-6 text-ink-2">
				Visual choices write only the supported v6.1.0 design fields. The saved JSON stays as it is until you choose
				Save changes.
			</p>

			<fieldset className="flex flex-col gap-3">
				<legend className="mb-1 text-sm font-semibold text-ink">Template</legend>
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
			</fieldset>

			<fieldset className="grid gap-4 sm:grid-cols-2">
				<legend className="mb-2 text-sm font-semibold text-ink">Type &amp; accent</legend>

				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Font pairing
					<select
						className={fieldClass}
						value={pairing}
						onChange={(event) => {
							const chosen = FONT_PAIRINGS.find((candidate) => candidate.id === event.target.value);
							if (chosen) onEdit({ type: "update-font-pairing", body: chosen.body, heading: chosen.heading });
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

				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Text size
					<input
						className={fieldClass}
						type="number"
						min={6}
						max={24}
						step={0.5}
						value={data.metadata.typography.body.fontSize}
						onChange={(event) =>
							onEdit({
								type: "update-text-size",
								bodySize: numberValue(event.target.value, data.metadata.typography.body.fontSize),
							})
						}
					/>
				</label>

				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Accent color
					<span className="flex items-center gap-2">
						<input
							type="color"
							aria-label="Accent color"
							className="h-9 w-12 rounded-sm border border-line-2 bg-surface"
							value={accent}
							onChange={(event) => onEdit({ type: "update-accent", color: fromHex(event.target.value) })}
						/>
						<code className="text-xs text-ink-3">{data.metadata.design.colors.primary}</code>
					</span>
				</label>
			</fieldset>

			<fieldset className="grid gap-4 sm:grid-cols-2">
				<legend className="mb-2 text-sm font-semibold text-ink">Density &amp; entry layout</legend>

				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Density
					<select
						className={fieldClass}
						value={density}
						onChange={(event) =>
							onEdit({ type: "update-density", density: event.target.value as DesignDensity })
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

				<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
					Entry layout
					<select
						className={fieldClass}
						value={entry.layout}
						onChange={(event) =>
							onEdit({
								type: "update-entry-layout",
								changes: { layout: event.target.value as EntryHeader["layout"] },
							})
						}
					>
						{entryHeaderLayouts.map((layout) => (
							<option key={layout} value={layout}>
								{titleCase(layout.replace("-", " "))}
							</option>
						))}
					</select>
				</label>

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
			</fieldset>

			<fieldset className="grid gap-4 sm:grid-cols-2">
				<legend className="mb-2 text-sm font-semibold text-ink">Page setup</legend>

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

				<div className="grid grid-cols-2 gap-3">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Horizontal margin
						<input
							className={fieldClass}
							type="number"
							min={0}
							max={100}
							value={data.metadata.page.marginX}
							onChange={(event) =>
								onEdit({
									type: "update-page",
									changes: { marginX: numberValue(event.target.value, data.metadata.page.marginX) },
								})
							}
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Vertical margin
						<input
							className={fieldClass}
							type="number"
							min={0}
							max={100}
							value={data.metadata.page.marginY}
							onChange={(event) =>
								onEdit({
									type: "update-page",
									changes: { marginY: numberValue(event.target.value, data.metadata.page.marginY) },
								})
							}
						/>
					</label>
				</div>
			</fieldset>

			<fieldset className="flex flex-col gap-3">
				<legend className="mb-1 text-sm font-semibold text-ink">Section order &amp; visibility</legend>
				<p className="text-xs leading-5 text-ink-3">
					Order is the first page's main and sidebar lists. Hidden sections keep their content and their place.
				</p>
				<div className="grid gap-3 md:grid-cols-2">
					<SectionList title="Main column" column="main" entries={sections.main} onEdit={onEdit} />
					<SectionList title="Sidebar column" column="sidebar" entries={sections.sidebar} onEdit={onEdit} />
				</div>
			</fieldset>
		</div>
	);
}
