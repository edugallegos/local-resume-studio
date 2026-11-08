import type { StoredResume } from "@local-resume/store/types";
import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon, type IconName } from "@reactive-resume/ui/components/icon";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckPanel } from "../features/check/check-panel";
import type { CheckIssue } from "../features/check/issue-model";
import {
	captureFitState,
	FIT_RENDER_TIMEOUT_MS,
	fitStateOf,
	fitToPages,
	type FitStep,
} from "../features/design/fit";
import { DesignPanel } from "../features/design/design-panel";
import { spillingSections } from "../features/design/spill";
import {
	templateDisplayName,
	type TemplateThumbnailDependencies,
} from "../features/design/template-thumbnail";
import type { ResumePdfRender } from "../features/export/render-resume-pdf";
import { type LoadPdfDocument, PdfPreview } from "../features/preview/pdf-preview";
import { WritePanel } from "../features/write/write-panel";
import { editResume, MARGIN_PRESETS, type ResumeEdit } from "../features/write/resume-edits";
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
	selectedIssue?: PageMapTarget | null;
	onReviewIssue: (issue: CheckIssue) => void;
	onShowOnPdf: (target: PageMapTarget) => void;
	/** The target selected by clicking the applied PDF preview. */
	selectedPreviewTarget?: PageMapTarget | null;
	onSelectPreviewTarget?: (target: PageMapTarget) => void;
	/** Tests can disable or inject the gallery's PDF thumbnail renderer. */
	designThumbnailsEnabled?: boolean;
	designThumbnailDependencies?: TemplateThumbnailDependencies;
	/** How long Fit waits for one completed PDF render before stopping; tests shorten it. */
	fitRenderTimeoutMs?: number;
	onReloadFromDisk?: () => void;
	onKeepEditing?: () => void;
	resolvingConflict?: boolean;
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
			"Run the deterministic local ATS score, inspect categorized issues with direct Write and PDF targets, compare a pasted posting, and analyze the generated PDF on demand. No remote service is involved.",
		items: ["Live score & issues", "Pasted job description", "Exported PDF analysis"],
	},
];

const conflictFallback =
	"This file changed on disk since you opened it. Your unsaved draft and its original ETag are still here.";

const formatUpdatedAt = (value: string | undefined): string | null => {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

/** The parent rebuilds the draft with Immer, so an equal edit is a new object; compare content for interference. */
const sameResume = (a: ResumeData | null, b: ResumeData | null): boolean =>
	a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** Maps one Fit step to the same typed edits the Design panel uses. */
const editForFitStep = (step: FitStep, data: ResumeData): ResumeEdit => {
	if (step.type === "density") return { type: "update-density", density: step.density };
	if (step.type === "margins") {
		const margins = MARGIN_PRESETS[step.margins];
		return { type: "update-page", changes: { marginX: margins.marginX, marginY: margins.marginY } };
	}

	const { body, heading } = data.metadata.typography;
	const ratio = body.fontSize > 0 ? heading.fontSize / body.fontSize : 1.4;
	const headingSize = Math.min(24, Math.max(6, Math.round(step.size * ratio * 2) / 2));
	return {
		type: "update-typography",
		body: { fontSize: step.size },
		heading: { fontSize: headingSize },
	};
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
	selectedIssue = null,
	onReviewIssue,
	onShowOnPdf,
	selectedPreviewTarget = null,
	onSelectPreviewTarget,
	designThumbnailsEnabled = true,
	designThumbnailDependencies,
	fitRenderTimeoutMs = FIT_RENDER_TIMEOUT_MS,
	onReloadFromDisk,
	onKeepEditing,
	resolvingConflict = false,
}: EditorShellProps) {
	const canSave = Boolean(
		state.data && state.selectedId && state.etag && state.dirty && state.status !== "saving",
	);
	const fullName = state.data?.basics.name.trim() || "Untitled resume";
	const label = resume?.label ?? state.selectedId ?? "no-file";
	const updatedAt = formatUpdatedAt(resume?.updatedAt);
	const appliedTemplate = state.data?.metadata.template ?? null;
	const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
	const isPreviewing = previewTemplate !== null && previewTemplate !== appliedTemplate;

	useEffect(() => {
		// A template only previews while Design is open; switching tabs restores the applied page.
		if (activeTab !== "design") setPreviewTemplate(null);
	}, [activeTab]);

	useEffect(() => {
		// Applying the template already clears the preview; this also catches a reload that lands on it.
		if (previewTemplate !== null && previewTemplate === appliedTemplate) setPreviewTemplate(null);
	}, [appliedTemplate, previewTemplate]);

	useEffect(() => {
		if (previewTemplate === null) return;
		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") setPreviewTemplate(null);
		};
		document.addEventListener("keydown", onEscape);
		return () => document.removeEventListener("keydown", onEscape);
	}, [previewTemplate]);

	const previewData = useMemo(() => {
		if (!state.data) return null;
		if (!previewTemplate || previewTemplate === state.data.metadata.template) return state.data;
		return { ...state.data, metadata: { ...state.data.metadata, template: previewTemplate } };
	}, [previewTemplate, state.data]);

	const [appliedRender, setAppliedRender] = useState<{
		result: ResumePdfRender;
		data: ResumeData;
	} | null>(null);
	const [fitRunning, setFitRunning] = useState(false);
	const [fitMessage, setFitMessage] = useState<string | null>(null);
	const dataRef = useRef<ResumeData | null>(state.data);
	dataRef.current = state.data;
	const renderStateRef = useRef<{ version: number; pageCount: number | null }>({ version: 0, pageCount: null });
	const renderWaitersRef = useRef(new Set<() => void>());
	const fitTokenRef = useRef(0);

	useEffect(() => {
		if (previewTemplate === null) return;
		// Starting a temporary preview supersedes a fit that is still waiting for an applied render.
		fitTokenRef.current += 1;
		setFitRunning(false);
	}, [previewTemplate]);

	const handlePreviewRendered = useCallback(
		(snapshot: { result: ResumePdfRender; data: ResumeData } | null) => {
			// A temporary template never becomes the downloadable PDF. The applied render keeps that role.
			if (isPreviewing) return;
			setAppliedRender(snapshot);
			const pageCount = snapshot ? snapshot.result.pageMap.pages.length || null : null;
			renderStateRef.current = { version: renderStateRef.current.version + 1, pageCount };
			for (const notify of [...renderWaitersRef.current]) notify();
			onPdfRendered?.(snapshot?.result ?? null);
		},
		[isPreviewing, onPdfRendered],
	);

	const waitForNextRender = (baseline: number): Promise<boolean> =>
		new Promise((resolve) => {
			if (renderStateRef.current.version > baseline) {
				resolve(true);
				return;
			}
			let timer: ReturnType<typeof setTimeout>;
			const settle = (arrived: boolean) => {
				clearTimeout(timer);
				renderWaitersRef.current.delete(notify);
				resolve(arrived);
			};
			const notify = () => settle(true);
			renderWaitersRef.current.add(notify);
			timer = setTimeout(() => settle(false), fitRenderTimeoutMs);
		});

	const runFit = async (): Promise<void> => {
		const current = dataRef.current;
		if (!current || fitRunning) return;

		const authored = Math.max(1, current.metadata.layout.pages.length);
		const initialPages = renderStateRef.current.pageCount;
		if (initialPages === null) {
			setFitMessage("Wait for the preview to finish before fitting.");
			return;
		}
		if (initialPages <= authored) {
			setFitMessage("Already fits.");
			return;
		}

		const token = fitTokenRef.current + 1;
		fitTokenRef.current = token;
		setFitRunning(true);
		setFitMessage(null);

		const snapshot = captureFitState(current.metadata);
		let working = current;
		let awaitingRender = false;
		let interrupted = false;
		let timedOut = false;

		const result = await fitToPages({
			initial: fitStateOf(current.metadata),
			isInterrupted: () =>
				token !== fitTokenRef.current || (!awaitingRender && !sameResume(dataRef.current, working)),
			apply: (step) => {
				if (!sameResume(dataRef.current, working)) {
					interrupted = true;
					return;
				}
				const edit = editForFitStep(step, working);
				working = editResume(working, edit);
				awaitingRender = true;
				onEdit(edit);
			},
			measure: async (afterStep) => {
				if (!afterStep) {
					if (renderStateRef.current.pageCount === null) {
						const baseline = renderStateRef.current.version;
						const arrived = await waitForNextRender(baseline);
						if (!arrived) {
							timedOut = true;
							return "timeout";
						}
					}
					if (!sameResume(dataRef.current, working)) {
						interrupted = true;
						return "overflow";
					}
					const pageCount = renderStateRef.current.pageCount;
					if (pageCount === null) {
						timedOut = true;
						return "timeout";
					}
					return pageCount <= authored ? "fit" : "overflow";
				}

				const baseline = renderStateRef.current.version;
				const arrived = await waitForNextRender(baseline);
				awaitingRender = false;
				if (!arrived) {
					timedOut = true;
					return "timeout";
				}
				if (!sameResume(dataRef.current, working)) {
					interrupted = true;
					return "overflow";
				}
				const pageCount = renderStateRef.current.pageCount;
				if (pageCount === null) {
					timedOut = true;
					return "timeout";
				}
				return pageCount <= authored ? "fit" : "overflow";
			},
		});

		if (token !== fitTokenRef.current) return;
		setFitRunning(false);

		if (interrupted || result.status === "interrupted") {
			const superseded = !sameResume(dataRef.current, working);
			setFitMessage(
				superseded
					? "Fit stopped because a newer edit superseded it. Your edit was kept."
					: "Fit stopped because the draft changed.",
			);
			return;
		}
		if (timedOut || result.status === "timeout") {
			const superseded = !sameResume(dataRef.current, working);
			const restored = result.applied && !superseded;
			if (restored) onEdit({ type: "restore-fit-state", state: snapshot });
			setFitMessage(
				superseded
					? "Fit stopped because a newer edit superseded it. Your edit was kept."
					: restored
						? "The preview took too long and the design was restored. Check the pages and try again."
						: "Fit stopped because the preview took too long. Check the pages and try again.",
			);
			return;
		}
		if (result.status === "exhausted") {
			// Nothing gained: put only the fit-related metadata back, unless no step was ever applied.
			if (result.applied) onEdit({ type: "restore-fit-state", state: snapshot });
			setFitMessage(
				result.applied
					? `Couldn't fit within ${authored} authored ${authored === 1 ? "page" : "pages"}, even at 9 pt. The design was restored.`
					: `Couldn't fit within ${authored} authored ${authored === 1 ? "page" : "pages"}, even at 9 pt. The design was unchanged.`,
			);
			return;
		}

		setFitMessage(result.applied ? "Fit applied." : "Already fits.");
	};

	const renderedPages = appliedRender ? appliedRender.result.pageMap.pages.length || null : null;
	const appliedRenderIsCurrent = appliedRender !== null && sameResume(appliedRender.data, state.data);
	// A stale map or a temporary template preview must never choose which sections move.
	const spillSections =
		!isPreviewing && appliedRenderIsCurrent && appliedRender && state.data
			? spillingSections(state.data.metadata.layout.pages, appliedRender.result.pageMap)
			: null;
	const renderStale = isPreviewing || (appliedRender !== null && !appliedRenderIsCurrent);

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

				{state.status === "conflict" ? (
					<div
						role="alert"
						className="mx-auto flex w-full max-w-[1600px] items-start gap-3 border-t border-warn bg-warn-soft px-4 py-2.5 text-sm text-warn-text sm:px-6"
					>
						<Icon name="warning-circle" className="mt-0.5 shrink-0" />
						<div className="flex flex-1 flex-col gap-2">
							<p className="leading-5">{saveMessage ?? conflictFallback}</p>
							{state.conflict?.loading ? <p className="text-xs">Checking the latest disk version…</p> : null}
							{state.conflict?.latestUpdatedAt ? (
								<p className="text-xs">
									Latest disk version updated{" "}
									<time dateTime={state.conflict.latestUpdatedAt}>
										{formatUpdatedAt(state.conflict.latestUpdatedAt)}
									</time>
									.
								</p>
							) : null}
							{state.conflict?.error ? (
								<p className="text-xs text-danger-text">
									Could not read the latest disk version: {state.conflict.error}
								</p>
							) : null}
							<div className="flex flex-wrap gap-2">
								{onReloadFromDisk ? (
									<Button
										size="sm"
										variant="secondary"
										onClick={onReloadFromDisk}
										disabled={resolvingConflict}
										loading={resolvingConflict}
										aria-label="Reload from disk"
									>
										Reload from disk
									</Button>
								) : null}
								{onKeepEditing ? (
									<Button size="sm" variant="ghost" onClick={onKeepEditing} aria-label="Keep editing">
										Keep editing
									</Button>
								) : null}
							</div>
						</div>
					</div>
				) : saveMessage ? (
					<div
						role="alert"
						className="mx-auto flex w-full max-w-[1600px] items-start gap-3 border-t border-danger bg-danger-soft px-4 py-2.5 text-sm text-danger-text sm:px-6"
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
						const isCheckPanel = tab.id === "check";
						const isNative = isWritePanel || isDesignPanel || isCheckPanel;
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
										{state.data ? (
											<DesignPanel
												data={state.data}
												onEdit={onEdit}
												onPreviewTemplate={setPreviewTemplate}
												thumbnailsEnabled={designThumbnailsEnabled && activeTab === "design"}
												thumbnailDependencies={designThumbnailDependencies}
												renderedPages={renderedPages}
												spillSections={spillSections}
												renderStale={renderStale}
												fitRunning={fitRunning}
												fitMessage={fitMessage}
												onFit={() => void runFit()}
											/>
										) : null}
										<div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-ink-3">
											<Icon name="info" />
											<span>Design edits use the same in-memory draft and Save changes flow.</span>
										</div>
									</div>
								) : (
									<div className="mt-6 flex flex-1 flex-col">
										{state.data ? (
											<CheckPanel
												data={state.data}
												onReviewIssue={onReviewIssue}
												onShowOnPdf={onShowOnPdf}
												selectedIssue={selectedIssue}
												renderPdf={renderPdf}
												loadPdfDocument={loadPdfDocument}
											/>
										) : null}
										<div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-ink-3">
											<Icon name="info" />
											<span>Checks run locally against this draft; nothing is uploaded or sent to an AI service.</span>
										</div>
									</div>
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
								{isPreviewing
									? "Temporary template preview. Download still uses the applied draft."
									: "The PDF shown here is the same Blob the download archives."}
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

					{isPreviewing && previewTemplate ? (
						<div
							role="status"
							data-testid="template-preview-status"
							className="flex items-center gap-2 border-b border-accent/30 bg-accent-soft px-4 py-2 text-xs font-medium text-accent-text"
						>
							<Icon name="eye" className="shrink-0" />
							<span>Previewing {templateDisplayName(previewTemplate)} · click to apply</span>
						</div>
					) : null}

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

					<div className="flex flex-1 flex-col overflow-auto bg-sunken p-4 sm:p-8">
						{previewData ? (
							<PdfPreview
								data={previewData}
								renderPdf={renderPdf}
								loadDocument={loadPdfDocument}
								selectedIssue={selectedIssue}
								selectedTarget={selectedPreviewTarget}
								onSelectTarget={onSelectPreviewTarget}
								onRenderSnapshot={handlePreviewRendered}
								interactive={!isPreviewing}
							/>
						) : null}
					</div>
				</aside>
			</main>
		</div>
	);
}
