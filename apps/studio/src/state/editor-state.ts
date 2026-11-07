import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type EditorStatus = "idle" | "loading" | "saving" | "saved" | "conflict" | "error";

/** The single source of truth for the open resume, its ETag, and unsaved-draft state. */
export type EditorState = {
	selectedId: string | null;
	data: ResumeData | null;
	etag: string | null;
	dirty: boolean;
	status: EditorStatus;
};

export type EditorAction =
	| { type: "load"; selectedId: string; data: ResumeData; etag: string }
	| { type: "edit"; data: ResumeData }
	| { type: "save-start" }
	| { type: "save-success"; data: ResumeData; etag: string }
	| { type: "save-conflict" }
	| { type: "load-error" }
	| { type: "reset" };

export const initialEditorState: EditorState = {
	selectedId: null,
	data: null,
	etag: null,
	dirty: false,
	status: "idle",
};

/**
 * Reducer rules that matter for data safety:
 * - A conflict never replaces the user's draft, selection, or dirty flag.
 * - A successful save replaces the base document and advances the ETag.
 * - Editing preserves an unresolved conflict state until it is explicitly resolved.
 */
export const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
	switch (action.type) {
		case "load":
			return {
				selectedId: action.selectedId,
				data: action.data,
				etag: action.etag,
				dirty: false,
				status: "saved",
			};

		case "edit":
			return {
				...state,
				data: action.data,
				dirty: true,
				status: state.status === "conflict" ? "conflict" : "idle",
			};

		case "save-start":
			return { ...state, status: "saving" };

		case "save-success":
			return {
				...state,
				data: action.data,
				etag: action.etag,
				dirty: false,
				status: "saved",
			};

		case "save-conflict":
			return { ...state, dirty: true, status: "conflict" };

		case "load-error":
			return { ...state, status: "error" };

		case "reset":
			return initialEditorState;
	}
};
