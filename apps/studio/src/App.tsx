import type { StoredResume } from "@local-resume/store/types";
import { Badge } from "@reactive-resume/ui/components/badge";
import { useMemo, useReducer, useState } from "react";
import { createResumeApiClient } from "./api/client";
import { type EditorTab, EditorShell } from "./components/editor-shell";
import { ResumeLibrary } from "./features/library/resume-library";
import { editorReducer, initialEditorState } from "./state/editor-state";

type View = "library" | "editor";

export function App() {
	const client = useMemo(() => createResumeApiClient(), []);
	const [state, dispatch] = useReducer(editorReducer, initialEditorState);
	const [view, setView] = useState<View>("library");
	const [activeTab, setActiveTab] = useState<EditorTab>("write");
	const [selectedResume, setSelectedResume] = useState<StoredResume | null>(null);

	const handleOpen = (resume: StoredResume): void => {
		dispatch({
			type: "load",
			selectedId: resume.id,
			data: resume.data,
			etag: resume.etag,
		});
		setSelectedResume(resume);
		setActiveTab("write");
		setView("editor");
	};

	const handleRenamed = (resume: StoredResume, previousId: string): void => {
		if (state.selectedId !== previousId) return;
		setSelectedResume(resume);
		// A clean editor can follow the new filename. A dirty draft keeps its original identity so
		// nothing is silently discarded; resolving that conflict belongs to the save workflow.
		if (!state.dirty) {
			dispatch({
				type: "load",
				selectedId: resume.id,
				data: resume.data,
				etag: resume.etag,
			});
		}
	};

	const handleDeleted = (id: string): void => {
		if (state.selectedId !== id) return;
		dispatch({ type: "reset" });
		setSelectedResume(null);
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
					onOpen={handleOpen}
					onRenamed={handleRenamed}
					onDeleted={handleDeleted}
				/>
			</main>
		</div>
	);
}
