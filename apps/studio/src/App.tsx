import type { StoredResume } from "@local-resume/store/types";
import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Badge } from "@reactive-resume/ui/components/badge";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createResumeApiClient, isResumeConflictError, type ResumeApiClient } from "./api/client";
import { type EditorTab, EditorShell } from "./components/editor-shell";
import type { CheckIssue } from "./features/check/issue-model";
import { downloadPdf as archiveAndDownloadPdf, type SavePdfFile } from "./features/export/download-pdf";
import { renderResumePdf, type ResumePdfRender } from "./features/export/render-resume-pdf";
import { ResumeLibrary } from "./features/library/resume-library";
import type { LoadPdfDocument } from "./features/preview/pdf-preview";
import { editResume, type ResumeEdit } from "./features/write/resume-edits";
import { editorReducer, initialEditorState } from "./state/editor-state";

type View = "library" | "editor";

export type AppProps = {
	/** Injected by tests; production uses the same-origin loopback API client. */
	client?: ResumeApiClient;
	/** Injected by tests so dirty-draft export stays deterministic. */
	downloadJson?: (filename: string, contents: string) => void;
	/** Injectable PDF engine and browser download for deterministic tests. */
	renderPdf?: (data: ResumeData) => Promise<ResumePdfRender>;
	loadPdfDocument?: LoadPdfDocument;
	savePdf?: SavePdfFile;
};

const conflictMessage =
	"This file changed on disk since you opened it. Your unsaved draft and its original ETag are still here and were not overwritten. Return to the library and save or resolve the conflict before switching files.";

const saveFailureMessage = (error: unknown): string => {
	const detail =
		error instanceof Error && error.message.trim() !== "" ? error.message : "The local resume API could not save the file.";
	return `Save failed: ${detail} Your unsaved draft is still here and remains dirty.`;
};

export function App({
	client: injectedClient,
	downloadJson,
	renderPdf = renderResumePdf,
	loadPdfDocument,
	savePdf,
}: AppProps = {}) {
	const client = useMemo<ResumeApiClient>(() => injectedClient ?? createResumeApiClient(), [injectedClient]);
	const [state, dispatch] = useReducer(editorReducer, initialEditorState);
	const [view, setView] = useState<View>("library");
	const [activeTab, setActiveTab] = useState<EditorTab>("write");
	const [selectedResume, setSelectedResume] = useState<StoredResume | null>(null);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [renderedPdf, setRenderedPdf] = useState<ResumePdfRender | null>(null);
	const [exportingPdf, setExportingPdf] = useState(false);
	const [exportMessage, setExportMessage] = useState<string | null>(null);
	const [writeFocus, setWriteFocus] = useState<{ fieldId: string; token: number } | null>(null);
	const focusToken = useRef(0);

	useEffect(() => {
		if (activeTab !== "write" || !writeFocus) return;
		const target = document.getElementById(writeFocus.fieldId);
		if (!target) return;
		target.scrollIntoView?.({ block: "center" });
		if (target instanceof HTMLElement) target.focus();
	}, [activeTab, writeFocus]);

	const handleOpen = (resume: StoredResume): void => {
		// Belts and braces: the library blocks these transitions too, but the editor never replaces a
		// dirty draft with server data even if a future caller forgets the guard.
		if (state.dirty && state.selectedId === resume.id) {
			setView("editor");
			return;
		}
		if (state.dirty && state.selectedId !== resume.id) return;

		dispatch({
			type: "load",
			selectedId: resume.id,
			data: resume.data,
			etag: resume.etag,
		});
		setSelectedResume(resume);
		setSaveMessage(null);
		setRenderedPdf(null);
		setExportMessage(null);
		setActiveTab("write");
		setView("editor");
	};

	const handleEdit = (edit: ResumeEdit): void => {
		if (!state.data) return;
		// The preview is recomputed from the new draft; never let an older Blob be downloaded as current.
		setRenderedPdf(null);
		setExportMessage(null);
		dispatch({ type: "edit", data: editResume(state.data, edit) });
	};

	const handleReviewIssue = (issue: CheckIssue): void => {
		if (!issue.editTarget) return;
		focusToken.current += 1;
		setWriteFocus({ fieldId: issue.editTarget.fieldId, token: focusToken.current });
		setActiveTab("write");
	};

	const handleShowOnPdf = (target: PageMapTarget): void => {
		dispatch({ type: "select-issue", target });
	};

	const handleSave = async (): Promise<void> => {
		if (!state.data || !state.selectedId || !state.etag || state.status === "saving") return;

		const id = state.selectedId;
		const etag = state.etag;
		const draft = state.data;

		setSaveMessage(null);
		dispatch({ type: "save-start" });

		try {
			const saved = await client.save(id, draft, etag);
			dispatch({
				type: "save-success",
				data: saved.data ?? draft,
				etag: saved.etag,
				submittedData: draft,
			});
			setSelectedResume(saved);
		} catch (error) {
			if (isResumeConflictError(error)) {
				// Keep the draft, selection, and ETag exactly as they were.
				dispatch({ type: "save-conflict" });
				setSaveMessage(conflictMessage);
				return;
			}

			// Every other failure keeps the same draft and dirty state so nothing disappears.
			dispatch({ type: "save-error" });
			setSaveMessage(saveFailureMessage(error));
		}
	};

	const handleRenamed = (resume: StoredResume, previousId: string): void => {
		if (state.selectedId !== previousId) return;
		// The library blocks this transition for a dirty draft; keep the same guard here so no
		// future caller can silently swap the draft's identity or ETag.
		if (state.dirty) return;

		setSelectedResume(resume);
		dispatch({
			type: "load",
			selectedId: resume.id,
			data: resume.data,
			etag: resume.etag,
		});
	};

	const handleDeleted = (id: string): void => {
		if (state.selectedId !== id) return;
		// A dirty draft is never deleted out from under the editor.
		if (state.dirty) return;
		dispatch({ type: "reset" });
		setSelectedResume(null);
		setSaveMessage(null);
		setRenderedPdf(null);
		setExportMessage(null);
		setView("library");
	};

	const handleDownloadPdf = async (): Promise<void> => {
		if (!renderedPdf || !state.selectedId || exportingPdf) return;

		const id = state.selectedId;
		const fallback = `${selectedResume?.label ?? id}.pdf`;
		setExportingPdf(true);
		setExportMessage(null);

		try {
			const filename = await archiveAndDownloadPdf({
				client,
				id,
				blob: renderedPdf.blob,
				fallbackFilename: fallback,
				...(savePdf ? { save: savePdf } : {}),
			});
			setExportMessage(`Archived in the local PDF store and downloaded as ${filename}.`);
		} catch (error) {
			const detail =
				error instanceof Error && error.message.trim() !== ""
					? error.message
					: "The local resume API could not archive the PDF.";
			setExportMessage(`Export failed: ${detail} The preview and your draft are unchanged.`);
		} finally {
			setExportingPdf(false);
		}
	};

	if (view === "editor" && state.data) {
		return (
			<EditorShell
				state={state}
				resume={selectedResume}
				activeTab={activeTab}
				onTabChange={setActiveTab}
				onBack={() => setView("library")}
				onEdit={handleEdit}
				onSave={() => void handleSave()}
				saveMessage={saveMessage}
				onDismissSaveMessage={() => {
					setSaveMessage(null);
					dispatch({ type: "clear-error" });
				}}
				renderPdf={renderPdf}
				loadPdfDocument={loadPdfDocument}
				onPdfRendered={setRenderedPdf}
				onDownloadPdf={() => void handleDownloadPdf()}
				pdfReady={renderedPdf !== null}
				exportingPdf={exportingPdf}
				exportMessage={exportMessage}
				onDismissExportMessage={() => setExportMessage(null)}
				selectedIssue={state.selectedIssue}
				onReviewIssue={handleReviewIssue}
				onShowOnPdf={handleShowOnPdf}
			/>
		);
	}

	return (
		<div className="min-h-dvh bg-bg text-ink">
			<header className="border-b border-line bg-surface">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
					<div className="flex items-center gap-3">
						<span className="flex size-9 items-center justify-center rounded-md bg-accent font-display text-lg text-on-accent">
							LR
						</span>
						<div>
							<p className="font-display text-xl leading-tight text-ink">Local Resume Studio</p>
							<p className="text-xs text-ink-3">Desk &amp; Paper · pinned Reactive Resume v6.1.0</p>
						</div>
					</div>
					<Badge variant="accent">Local only</Badge>
				</div>
			</header>

			<main>
				<ResumeLibrary
					client={client}
					selectedId={state.selectedId}
					activeDirtyId={state.dirty ? state.selectedId : null}
					activeDraft={state.dirty ? state.data : null}
					onResumeActive={() => setView("editor")}
					onOpen={handleOpen}
					onRenamed={handleRenamed}
					onDeleted={handleDeleted}
					downloadJson={downloadJson}
				/>
			</main>
		</div>
	);
}
