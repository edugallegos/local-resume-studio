import type { StoredResume } from "@local-resume/store/types";
import { Badge } from "@reactive-resume/ui/components/badge";
import { useMemo, useReducer, useState } from "react";
import { createResumeApiClient, isResumeConflictError, type ResumeApiClient } from "./api/client";
import { type EditorTab, EditorShell } from "./components/editor-shell";
import { ResumeLibrary } from "./features/library/resume-library";
import { editResume, type ResumeEdit } from "./features/write/resume-edits";
import { editorReducer, initialEditorState } from "./state/editor-state";

type View = "library" | "editor";

export type AppProps = {
	/** Injected by tests; production uses the same-origin loopback API client. */
	client?: ResumeApiClient;
	/** Injected by tests so dirty-draft export stays deterministic. */
	downloadJson?: (filename: string, contents: string) => void;
};

const conflictMessage =
	"This file changed on disk since you opened it. Your unsaved draft and its original ETag are still here and were not overwritten. Return to the library and save or resolve the conflict before switching files.";

const saveFailureMessage = (error: unknown): string => {
	const detail =
		error instanceof Error && error.message.trim() !== "" ? error.message : "The local resume API could not save the file.";
	return `Save failed: ${detail} Your unsaved draft is still here and remains dirty.`;
};

export function App({ client: injectedClient, downloadJson }: AppProps = {}) {
	const client = useMemo<ResumeApiClient>(() => injectedClient ?? createResumeApiClient(), [injectedClient]);
	const [state, dispatch] = useReducer(editorReducer, initialEditorState);
	const [view, setView] = useState<View>("library");
	const [activeTab, setActiveTab] = useState<EditorTab>("write");
	const [selectedResume, setSelectedResume] = useState<StoredResume | null>(null);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);

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
		setActiveTab("write");
		setView("editor");
	};

	const handleEdit = (edit: ResumeEdit): void => {
		if (!state.data) return;
		dispatch({ type: "edit", data: editResume(state.data, edit) });
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
		setView("library");
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
