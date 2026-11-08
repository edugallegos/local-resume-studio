import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { cn } from "@reactive-resume/utils/style";
import type { LayoutColumn, ResumeEdit } from "../write/resume-edits";
import { fieldClass, NumberInput } from "./design-ui";
import { sectionEntriesForPage, type SectionEntry } from "./section-labels";

const COLUMN_LABELS: Record<LayoutColumn, string> = { main: "Main", sidebar: "Sidebar" };

type PageLayoutProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
	/** The overflow status owns the primary Add page button when both are on screen. */
	showAddPage?: boolean;
};

function SectionRow({
	data,
	pageIndex,
	column,
	index,
	entry,
	onEdit,
}: {
	data: ResumeData;
	pageIndex: number;
	column: LayoutColumn;
	index: number;
	entry: SectionEntry;
	onEdit: (edit: ResumeEdit) => void;
}) {
	const entries = sectionEntriesForPage(data, pageIndex, column);
	const other: LayoutColumn = column === "main" ? "sidebar" : "main";

	return (
		<li className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface px-2 py-1.5">
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
					onClick={() =>
						onEdit({
							type: "move-section-to-slot",
							sectionId: entry.id,
							pageIndex,
							column,
							toIndex: index - 1,
						})
					}
				>
					↑
				</button>
				<button
					type="button"
					className="rounded-sm border border-line-2 px-1.5 py-0.5 text-xs text-ink-2 disabled:opacity-40"
					aria-label={`Move ${entry.label} down`}
					disabled={index === entries.length - 1}
					onClick={() =>
						onEdit({
							type: "move-section-to-slot",
							sectionId: entry.id,
							pageIndex,
							column,
							toIndex: index + 1,
						})
					}
				>
					↓
				</button>
				<button
					type="button"
					className="rounded-sm border border-line-2 px-1.5 py-0.5 text-xs text-ink-2"
					aria-label={`Move ${entry.label} to ${other}`}
					onClick={() =>
						onEdit({ type: "move-section-to-slot", sectionId: entry.id, pageIndex, column: other })
					}
				>
					{other === "sidebar" ? "→" : "←"}
				</button>
			</div>
			<select
				className="h-7 min-w-0 rounded-sm border border-line-2 bg-surface px-1 text-xs text-ink-2"
				aria-label={`Move ${entry.label} page`}
				value={`${pageIndex}:${column}`}
				onChange={(event) => {
					const [targetPage, targetColumn] = event.target.value.split(":");
					onEdit({
						type: "move-section-to-slot",
						sectionId: entry.id,
						pageIndex: Number(targetPage),
						column: targetColumn === "sidebar" ? "sidebar" : "main",
					});
				}}
			>
				{data.metadata.layout.pages.map((_, targetPage) =>
					(["main", "sidebar"] as const).map((targetColumn) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: page order is the layout's own sequence and pages have no id.
						<option key={`${targetPage}:${targetColumn}`} value={`${targetPage}:${targetColumn}`}>
							Page {targetPage + 1} · {COLUMN_LABELS[targetColumn]}
						</option>
					)),
				)}
			</select>
		</li>
	);
}

function SectionColumn({
	data,
	pageIndex,
	column,
	entries,
	onEdit,
}: {
	data: ResumeData;
	pageIndex: number;
	column: LayoutColumn;
	entries: SectionEntry[];
	onEdit: (edit: ResumeEdit) => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-sunken/40 p-3">
			<h5 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">
				{COLUMN_LABELS[column]}
			</h5>
			{entries.length === 0 ? <p className="text-xs text-ink-3">No sections in this column.</p> : null}
			<ol className="flex flex-col gap-1.5">
				{entries.map((entry, index) => (
					<SectionRow
						key={entry.id}
						data={data}
						pageIndex={pageIndex}
						column={column}
						index={index}
						entry={entry}
						onEdit={onEdit}
					/>
				))}
			</ol>
		</div>
	);
}

/** Page-by-page main/sidebar placement with accessible move controls and no drag-and-drop dependency. */
export function PageLayout({ data, onEdit, showAddPage = true }: PageLayoutProps) {
	const pages = data.metadata.layout.pages;
	const templateLayout = templateLayouts[data.metadata.template];
	const twoColumns = templateLayout.columns === 2;
	const effectiveSide = data.metadata.layout.sidebarSide ?? templateLayout.sidebarSide ?? "left";

	return (
		<div className="flex flex-col gap-4">
			{pages.map((page, pageIndex) => {
				const main = sectionEntriesForPage(data, pageIndex, "main");
				const sidebar = sectionEntriesForPage(data, pageIndex, "sidebar");
				return (
					<section
						// biome-ignore lint/suspicious/noArrayIndexKey: page order is the layout's own sequence and pages have no id.
						key={`page-${pageIndex}`}
						data-page-index={pageIndex}
						className="flex flex-col gap-3 rounded-md border border-dashed border-line-2 bg-surface/60 p-3"
					>
						<div className="flex flex-wrap items-center gap-3">
							<h4 className="me-auto text-sm font-semibold text-ink">Page {pageIndex + 1}</h4>
							<label className="flex items-center gap-2 text-xs font-medium text-ink-2">
								<input
									type="checkbox"
									aria-label={`Full width for page ${pageIndex + 1}`}
									checked={page.fullWidth}
									onChange={(event) =>
										onEdit({
											type: "set-page-full-width",
											pageIndex,
											fullWidth: event.target.checked,
										})
									}
								/>
								Full width
							</label>
							{pages.length > 1 ? (
								<button
									type="button"
									className="rounded-sm border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-hover"
									aria-label={`Remove page ${pageIndex + 1}`}
									onClick={() => onEdit({ type: "remove-page", pageIndex })}
								>
									Remove page
								</button>
							) : null}
						</div>

						<div
							className={cn(
								"grid gap-3",
								!page.fullWidth && "md:grid-cols-2",
							)}
						>
							<SectionColumn
								data={data}
								pageIndex={pageIndex}
								column="main"
								entries={main}
								onEdit={onEdit}
							/>
							{!page.fullWidth ? (
								<SectionColumn
									data={data}
									pageIndex={pageIndex}
									column="sidebar"
									entries={sidebar}
									onEdit={onEdit}
								/>
							) : null}
						</div>
					</section>
				);
			})}

			{showAddPage ? (
				<button
					type="button"
					className="self-start rounded-sm border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-hover"
					onClick={() => onEdit({ type: "add-page" })}
				>
					Add page
				</button>
			) : null}

			{twoColumns ? (
				<div className="grid gap-3 rounded-md border border-line bg-surface p-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Sidebar side
						<select
							className={fieldClass}
							value={effectiveSide}
							onChange={(event) =>
								onEdit({
									type: "set-sidebar-side",
									side: event.target.value === "right" ? "right" : "left",
								})
							}
						>
							<option value="left">Left</option>
							<option value="right">Right</option>
						</select>
					</label>
					<div className="flex flex-col gap-1 text-xs font-medium text-ink-2">
						Sidebar width
						<NumberInput
							label="Sidebar width"
							min={10}
							max={50}
							step={1}
							value={data.metadata.layout.sidebarWidth}
							onValueChange={(width) => onEdit({ type: "set-sidebar-width", width })}
						/>
						</div>
				</div>
			) : null}
		</div>
	);
}
