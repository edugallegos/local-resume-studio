import type { StoredResume } from "@local-resume/store/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon, type IconName } from "@reactive-resume/ui/components/icon";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import type { ReactNode } from "react";
import { DesignPanel } from "../features/design/design-panel";
import type { ResumePdfRender } from "../features/export/render-resume-pdf";
import { type LoadPdfDocument, PdfPreview } from "../features/preview/pdf-preview";
import { WritePanel } from "../features/write/write-panel";
import type { ResumeEdit } from "../features/write/resume-edits";
import type { EditorState } from "../state/editor-state";

export type EditorTab = "write" | "design" | "check";

export type EditorShellProps = {
	state: EditorState;
	resume: StoredResume | null;
	activeTab: EditorTab;
	onTabChange: (tab: EditorTab) => void;
	onBack: () => void;
	onEdit: (edit: ResumeEdit) => void;
	onSave: () => void;
	/** Conflict or save failure text. The draft is never replaced by this message. */
	saveMessage?: string | null;
	onDismissSaveMessage?: () => void;
	/** PDF rendering engine; tests inject a deterministic adapter. */
	renderPdf?: (data: ResumeData) => Promise<ResumePdfRender>;
	loadPdfDocument?: LoadPdfDocument;
	/** Receives the exact Blob the preview shows, or null when a render fails. */
	onPdfRendered?: (result: ResumePdfRender | null) => void;
	onDownloadPdf?: () => void;
	pdfReady?: boolean;
	exportingPdf?: boolean;
	exportMessage?: string | null;
	onDismissExportMessage?: () => void;
};

type TabDefinition = {
	id: EditorTab;
	label: string;
	icon: IconName;
	description: string;
	items: string[];
};

const tabs: TabDefinition[] = [
	{
		id: "write",
		label: "Write",
		icon: "pencil-simple",
		description: "Edit basics, summary, and the core resume sections. Save explicitly when you are ready to write.",
		items: ["Basics & summary", "Experience, education, projects", "Skills, languages, certifications"],
	},
	{
		id: "design",
		label: "Design",
		icon: "palette",
		description:
			"Choose among all 18 pinned templates, pair body and heading fonts, tune density and entry layout, set page size, margins, text size, accent color, and arrange section order and visibility.",
		items: ["All 18 pinned templates", "Font pairing & page setup", "Section order & visibility"],
	},
	{
		id: "check",
		label: "Check",
		icon: "list-checks",
		description:
			"The deterministic local score, categorized issues, job-description match, and exported-PDF analysis arrive in Task 7. No remote service is involved.",
		items: ["Live score & issues", "Pasted job description", "Exported PDF analysis"],
	},
];

const formatUpdatedAt = (value: string | undefined): string | null => {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

function SaveState({ state, saveMessage }: { state: EditorState; saveMessage?: string | null }) {
	let content: ReactNode;

	switch (state.status) {
		case "conflict":
			content = (
				<>
					<Badge variant="warn">Save conflict</Badge>
					<span className="text-xs text-warn-text">Your draft is kept</span>
				</>
			);
			break;
		case "saving":
			content = (
				<>
					<Spinner decorative />
					<span className="text-xs text-ink-2">Saving…</span>
				</>
			);
			break;
		case "loading":
			content = (
				<>
					<Spinner decorative />
					<span className="text-xs text-ink-2">Loading…</span>
				</>
			);
			break;
		case "error":
			content = saveMessage ? (
				<>
					<Badge variant="danger">Save failed</Badge>
					<span className="text-xs text-danger-text">Draft kept</span>
				</>
			) : (
				<>
					<Badge variant="danger">Load error</Badge>
					<span className="text-xs text-danger-text">Draft kept</span>
				</>
			);
			break;
		case "saved":
			content = (
				<>
					<Icon name="check-circle" className="text-accent-text" />
					<span className="text-xs text-accent-text">Saved</span>
				</>
			);
			break;
		default:
			content = state.dirty ? (
				<>
					<Badge variant="warn">Unsaved changes</Badge>
					<span className="text-xs text-ink-2">Not written yet</span>
				</>
			) : (
				<span className="text-xs text-ink-2">Ready</span>
			);
	}

	return (
		<div aria-live="polite" aria-atomic="true" className="flex flex-wrap items-center justify-end gap-2">
			{content}
		</div>
	);
}

export function EditorShell({
	state,
	resume,
	activeTab,
	onTabChange,
	onBack,
	onEdit,
	onSave,
	saveMessage = null,
	onDismissSaveMessage,
	renderPdf,
	loadPdfDocument,
	onPdfRendered,
	onDownloadPdf,
	pdfReady = false,
	exportingPdf = false,
	exportMessage = null,
	onDismissExportMessage,
}: EditorShellProps) {
	const canSave = Boolean(
		state.data && state.selectedId && state.etag && state.dirty && state.status !== "saving",
	);
	const fullName = state.data?.basics.name.trim() || "Untitled resume";
	const label = resume?.label ?? state.selectedId ?? "no-file";
	const updatedAt = formatUpdatedAt(resume?.updatedAt);

	return (
		<div className="flex min-h-dvh flex-col bg-bg text-ink">
			<header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
				<div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
					<Button variant="ghost" size="sm" onClick={onBack}>
						<Icon name="arrow-left" />
						Library
					</Button>

					<Separator orientation="vertical" className="hidden h-7 sm:block" />

					<div className="min-w-0 flex-1">
						<h1 className="truncate text-sm font-semibold leading-tight text-ink">{fullName}</h1>
						<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
							<span className="font-mono">{label}</span>
							{updatedAt ? (
								<>
									<span aria-hidden="true">·</span>
									<span>Updated {updatedAt}</span>
								</>
							) : null}
						</p>
					</div>

					<SaveState state={state} saveMessage={saveMessage} />

					<Button
						variant="primary"
						size="sm"
						onClick={onSave}
						loading={state.status === "saving"}
						disabled={!canSave}
						aria-label="Save changes"
					>
						<Icon name="check" />
						Save changes
					</Button>
				</div>

				{saveMessage ? (
					<div
						role="alert"
						className={cn(
							"mx-auto flex w-full max-w-[1600px] items-start gap-3 border-t px-4 py-2.5 text-sm sm:px-6",
							state.status === "conflict"
								? "border-warn bg-warn-soft text-warn-text"
								: "border-danger bg-danger-soft text-danger-text",
						)}
					>
						<Icon name="warning-circle" className="mt-0.5 shrink-0" />
						<p className="flex-1 leading-5">{saveMessage}</p>
						{onDismissSaveMessage ? (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Dismiss save message"
								onClick={onDismissSaveMessage}
								className="shrink-0"
							>
								<Icon name="x" />
							</Button>
						) : null}
					</div>
				) : null}
			</header>

			<main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 items-start gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.4fr)] lg:gap-6 lg:py-6">
				<section
					aria-label="Resume workspace"
					className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e1"
				>
					<div
						role="tablist"
						aria-label="Resume editor sections"
						className="flex gap-1 overflow-x-auto border-b border-line px-2"
					>
						{tabs.map((tab) => {
							const selected = tab.id === activeTab;
							return (
								<Button
									key={tab.id}
									variant="ghost"
									role="tab"
									id={`editor-tab-${tab.id}`}
									aria-selected={selected}
									aria-controls={`editor-panel-${tab.id}`}
									onClick={() => onTabChange(tab.id)}
									className={cn(
										"rounded-none border-b-2 px-3",
										selected
											? "border-accent text-accent-text"
											: "border-transparent text-ink-2 hover:text-ink",
									)}
								>
									<Icon name={tab.icon} />
									{tab.label}
								</Button>
							);
						})}
					</div>

					{tabs.map((tab) => {
						const selected = tab.id === activeTab;
						const isWritePanel = tab.id === "write";
						const isDesignPanel = tab.id === "design";
						const isNative = isWritePanel || isDesignPanel;
						return (
							<section
								key={tab.id}
								role="tabpanel"
								id={`editor-panel-${tab.id}`}
								aria-labelledby={`editor-tab-${tab.id}`}
								hidden={!selected}
								className={cn("flex flex-1 flex-col p-5 sm:p-6", !selected && "hidden")}
							>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-3">Workspace</p>
										<h2 className="mt-1 font-display text-2xl leading-tight text-ink">{tab.label}</h2>
									</div>
									<Badge variant={isNative ? "accent" : "info"}>
										{isNative ? "Native editing" : "Placeholder"}
									</Badge>
								</div>

								<p className="mt-3 max-w-xl text-sm leading-6 text-ink-2">{tab.description}</p>

								{isWritePanel ? (
									<div className="mt-6 flex flex-1 flex-col">
										{state.data ? <WritePanel data={state.data} onEdit={onEdit} /> : null}
										<div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-ink-3">
											<Icon name="info" />
											<span>Edits stay in this in-memory draft until you choose Save changes.</span>
										</div>
									</div>
								) : isDesignPanel ? (
									<div className="mt-6 flex flex-1 flex-col">
										{state.data ? <DesignPanel data={state.data} onEdit={onEdit} /> : null}
										<div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-ink-3">
											<Icon name="info" />
											<span>Design edits use the same in-memory draft and Save changes flow.</span>
										</div>
									</div>
								) : (
									<>
										<ul className="mt-6 grid gap-3 sm:grid-cols-3">
											{tab.items.map((item, index) => (
												<li
													key={item}
													className="rounded-md border border-line bg-sunken/60 px-3 py-3 text-xs leading-5 text-ink-2"
												>
													<span className="mb-2 flex size-6 items-center justify-center rounded-sm bg-surface text-ink-3 ring-1 ring-line">
														{index + 1}
													</span>
													{item}
												</li>
											))}
										</ul>

										<div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-ink-3">
											<Icon name="info" />
											<span>Controls arrive in Task 7; the preview already uses the same rendered PDF.</span>
										</div>
									</>
								)}
							</section>
						);
					})}
				</section>

				<aside
					aria-labelledby="preview-title"
					className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]"
				>
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
						<div>
							<h2 id="preview-title" className="text-sm font-semibold text-ink">
								Live PDF preview
							</h2>
							<p className="mt-0.5 text-xs text-ink-3">
								The PDF shown here is the same Blob the download archives.
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant={pdfReady ? "accent" : "outline"}>{pdfReady ? "PDF ready" : "Rendering"}</Badge>
							<Button
								variant="secondary"
								size="sm"
								onClick={onDownloadPdf}
								disabled={!pdfReady || exportingPdf}
								loading={exportingPdf}
								aria-label="Download PDF"
							>
								<Icon name="download-simple" />
								Download PDF
							</Button>
						</div>
					</div>

					{exportMessage ? (
						<div
							role={exportMessage.startsWith("Export failed") ? "alert" : "status"}
							className={cn(
								"flex items-start gap-3 border-b px-4 py-2.5 text-sm",
								exportMessage.startsWith("Export failed")
									? "border-danger bg-danger-soft text-danger-text"
									: "border-line bg-sunken text-ink-2",
							)}
						>
							<Icon
								name={exportMessage.startsWith("Export failed") ? "warning-circle" : "check-circle"}
								className="mt-0.5 shrink-0"
							/>
							<p className="flex-1 leading-5">{exportMessage}</p>
							{onDismissExportMessage ? (
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Dismiss export message"
									onClick={onDismissExportMessage}
									className="shrink-0"
								>
									<Icon name="x" />
								</Button>
							) : null}
						</div>
					) : null}

					<div className="flex flex-1 justify-center overflow-auto bg-sunken p-4 sm:p-8">
						{state.data ? (
							<PdfPreview
								data={state.data}
								renderPdf={renderPdf}
								loadDocument={loadPdfDocument}
								onRendered={onPdfRendered}
							/>
						) : null}
					</div>
				</aside>
			</main>
		</div>
	);
}
