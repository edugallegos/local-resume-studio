import { fontList, type FontWeight } from "@reactive-resume/fonts";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { cn } from "@reactive-resume/utils/style";
import type { ResumeEdit } from "../write/resume-edits";
import { hexToRgba, rgbaToHex } from "./design-color";
import { fieldClass, NumberInput } from "./design-ui";

const WEIGHTS: FontWeight[] = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

const fontFamilies = [...new Set(fontList.map((font) => font.family))].sort((a, b) => a.localeCompare(b));

const LEVEL_TYPES = [
	["hidden", "Hidden"],
	["circle", "Circle"],
	["square", "Square"],
	["rectangle", "Rectangle"],
	["rectangle-full", "Full rectangle"],
	["progress-bar", "Progress bar"],
	["icon", "Icon"],
] as const;

const DATE_FORMATS = [
	["short", "Mar 2022"],
	["long", "March 2022"],
	["numeric", "03/2022"],
	["iso", "2022-03"],
] as const;

type AdvancedGroupProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
};

/** Exact design values. This intentionally has no semantic stylesheet editor: `styleRules`/`stylesheet` stay untouched. */
export function AdvancedGroup({ data, onEdit }: AdvancedGroupProps) {
	const typography = data.metadata.typography;
	const page = data.metadata.page;
	const design = data.metadata.design;

	return (
		<div className="flex flex-col gap-6">
			<section className="flex flex-col gap-3">
				<h3 className="text-sm font-semibold text-ink">Typography</h3>
				<div className="grid gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Body font family
						<select
							className={fieldClass}
							value={typography.body.fontFamily}
							onChange={(event) =>
								onEdit({ type: "update-typography", body: { fontFamily: event.target.value } })
							}
						>
							{fontFamilies.map((family) => (
								<option key={family} value={family}>
									{family}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Heading font family
						<select
							className={fieldClass}
							value={typography.heading.fontFamily}
							onChange={(event) =>
								onEdit({ type: "update-typography", heading: { fontFamily: event.target.value } })
							}
						>
							{fontFamilies.map((family) => (
								<option key={family} value={family}>
									{family}
								</option>
							))}
						</select>
					</label>

					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Body font weights
						<fieldset aria-label="Body font weights" className="m-0 flex flex-wrap gap-1 border-0 p-0">
							{WEIGHTS.map((weight) => {
								const checked = typography.body.fontWeights.includes(weight);
								return (
									<label
										key={weight}
										className={cn(
											"flex items-center gap-1 rounded-sm border px-1.5 py-1 font-mono text-[11px]",
											checked
												? "border-accent bg-accent-soft text-accent-text"
												: "border-line-2 text-ink-2",
										)}
									>
										<input
											type="checkbox"
											aria-label={`Body weight ${weight}`}
											checked={checked}
											onChange={(event) => {
												const next = event.target.checked
													? [...typography.body.fontWeights, weight]
													: typography.body.fontWeights.filter(
															(candidate) => candidate !== weight,
														);
												if (next.length === 0) return;
												onEdit({ type: "update-typography", body: { fontWeights: next } });
											}}
										/>
										{weight}
									</label>
								);
							})}
						</fieldset>
					</div>
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Heading font weight
						<select
							className={fieldClass}
							value={typography.heading.fontWeights[0] ?? "600"}
							onChange={(event) =>
								onEdit({
									type: "update-typography",
									heading: { fontWeights: [event.target.value as FontWeight] },
								})
							}
						>
							{WEIGHTS.map((weight) => (
								<option key={weight} value={weight}>
									{weight}
								</option>
							))}
						</select>
					</label>

					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Body font size
						<NumberInput
							label="Body font size"
							min={6}
							max={24}
							step={0.5}
							value={typography.body.fontSize}
							onValueChange={(fontSize) => onEdit({ type: "update-typography", body: { fontSize } })}
						/>
						</div>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Body line height
						<NumberInput
							label="Body line height"
							min={0.5}
							max={4}
							step={0.05}
							value={typography.body.lineHeight}
							onValueChange={(lineHeight) =>
								onEdit({ type: "update-typography", body: { lineHeight } })
							}
						/>
						</div>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Heading font size
						<NumberInput
							label="Heading font size"
							min={6}
							max={24}
							step={0.5}
							value={typography.heading.fontSize}
							onValueChange={(fontSize) =>
								onEdit({ type: "update-typography", heading: { fontSize } })
							}
						/>
						</div>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Heading line height
						<NumberInput
							label="Heading line height"
							min={0.5}
							max={4}
							step={0.05}
							value={typography.heading.lineHeight}
							onValueChange={(lineHeight) =>
								onEdit({ type: "update-typography", heading: { lineHeight } })
							}
						/>
						</div>
				</div>
				<label className="flex items-center gap-2 text-xs font-medium text-ink-2">
					<input
						type="checkbox"
						checked={typography.hyphenation === true}
						onChange={(event) =>
							onEdit({ type: "update-typography", hyphenation: event.target.checked })
						}
					/>
					Hyphenation
				</label>
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="text-sm font-semibold text-ink">Color and level</h3>
				<div className="grid gap-3 sm:grid-cols-3">
					<ColorField
						label="Primary color"
						value={design.colors.primary}
						onChange={(color) => onEdit({ type: "update-design-colors", colors: { primary: color } })}
					/>
					<ColorField
						label="Text color"
						value={design.colors.text}
						onChange={(color) => onEdit({ type: "update-design-colors", colors: { text: color } })}
					/>
					<ColorField
						label="Background color"
						value={design.colors.background}
						onChange={(color) =>
							onEdit({ type: "update-design-colors", colors: { background: color } })
						}
					/>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Level display
						<select
							className={fieldClass}
							value={design.level.type}
							onChange={(event) =>
								onEdit({
									type: "update-level-design",
									changes: { type: event.target.value as typeof design.level.type },
								})
							}
						>
							{LEVEL_TYPES.map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Level icon
						<input
							className={fieldClass}
							value={design.level.icon}
							onChange={(event) =>
								onEdit({ type: "update-level-design", changes: { icon: event.target.value } })
							}
						/>
					</label>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="text-sm font-semibold text-ink">Page</h3>
				<div className="grid gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Page locale
						<input
							className={fieldClass}
							value={page.locale}
							onChange={(event) => onEdit({ type: "update-page", changes: { locale: event.target.value } })}
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Date format
						<select
							className={fieldClass}
							value={page.dateFormat ?? "short"}
							onChange={(event) =>
								onEdit({
									type: "update-page",
									changes: { dateFormat: event.target.value as typeof page.dateFormat },
								})
							}
						>
							{DATE_FORMATS.map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Horizontal spacing
						<NumberInput
							label="Horizontal spacing"
							min={0}
							step={0.5}
							value={page.gapX}
							onValueChange={(gapX) => onEdit({ type: "update-page", changes: { gapX } })}
						/>
						</div>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Vertical spacing
						<NumberInput
							label="Vertical spacing"
							min={0}
							step={0.5}
							value={page.gapY}
							onValueChange={(gapY) => onEdit({ type: "update-page", changes: { gapY } })}
						/>
						</div>
				</div>
				<div className="grid gap-2 text-xs font-medium text-ink-2">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={!page.hideIcons}
							onChange={(event) =>
								onEdit({ type: "update-page", changes: { hideIcons: !event.target.checked } })
							}
						/>
						Icons in contact line
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={!page.hideLinkUnderline}
							onChange={(event) =>
								onEdit({
									type: "update-page",
									changes: { hideLinkUnderline: !event.target.checked },
								})
							}
						/>
						Underline links
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={!page.hideSectionIcons}
							onChange={(event) =>
								onEdit({
									type: "update-page",
									changes: { hideSectionIcons: !event.target.checked },
								})
							}
						/>
						Section icons
					</label>
				</div>
			</section>

			<div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
				<button
					type="button"
					className="rounded-sm border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-hover"
					onClick={() => onEdit({ type: "reset-design" })}
				>
					Reset design defaults
				</button>
				<p className="text-xs leading-5 text-ink-3">
					Resets fonts, colors, spacing, and visibility. Resume content, page placement, locale, date format,
					and custom styles stay as they are.
				</p>
			</div>
		</div>
	);
}

function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (color: string) => void;
}) {
	const hex = rgbaToHex(value) ?? "#000000";
	return (
		<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
			{label}
			<span className="flex items-center gap-2">
				<input
					type="color"
					aria-label={label}
					className="h-9 w-12 rounded-sm border border-line-2 bg-surface"
					value={hex}
					onChange={(event) => onChange(hexToRgba(event.target.value))}
				/>
				<code className="truncate text-[11px] text-ink-3">{hex}</code>
			</span>
		</label>
	);
}
