import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type EditorStatus = "idle" | "loading" | "saving" | "saved" | "conflict" | "error";

/** Latest disk details fetched separately after a 409. The draft itself is never replaced here. */
export type ConflictState = {
	loading: boolean;
	latestUpdatedAt: string | null;
	error: string | null;
};

/** The single source of truth for the open resume, its ETag, and unsaved-draft state. */
export type EditorState = {
	selectedId: string | null;
	data: ResumeData | null;
	etag: string | null;
	dirty: boolean;
	status: EditorStatus;
	/** The Check issue target currently highlighted on the PDF preview, if any. */
	selectedIssue: PageMapTarget | null;
	conflict: ConflictState | null;
};

export type EditorAction =
	| { type: "load"; selectedId: string; data: ResumeData; etag: string }
	| { type: "edit"; data: ResumeData }
	| { type: "save-start" }
	| { type: "save-success"; data: ResumeData; etag: string; submittedData?: ResumeData }
	| { type: "save-conflict" }
	| { type: "external-change" }
	| { type: "conflict-details"; latestUpdatedAt?: string | null; error?: string | null }
	| { type: "keep-editing" }
	| { type: "save-error" }
	| { type: "clear-error" }
	| { type: "load-error" }
	| { type: "select-issue"; target: PageMapTarget | null }
	| { type: "reset" };

export const initialEditorState: EditorState = {
	selectedId: null,
	data: null,
	etag: null,
	dirty: false,
	status: "idle",
	selectedIssue: null,
	conflict: null,
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
				selectedIssue: null,
				conflict: null,
			};

		case "edit":
			return {
				...state,
				data: action.data,
				dirty: true,
				selectedIssue: null,
				status:
					state.status === "conflict" ? "conflict" : state.status === "saving" ? "saving" : "idle",
			};

		case "select-issue":
			return { ...state, selectedIssue: action.target };

		case "save-start":
			return { ...state, status: "saving", conflict: null };

		case "save-success": {
			const editedDuringSave =
				state.data !== null && action.submittedData !== undefined && state.data !== action.submittedData;

			if (editedDuringSave) {
				// The response is for an older snapshot. Keep the newer draft and make it saveable
				// against the ETag the successful write just produced.
				return { ...state, etag: action.etag, dirty: true, status: "idle", conflict: null };
			}

			return {
				...state,
				data: action.data,
				etag: action.etag,
				dirty: false,
				status: "saved",
				conflict: null,
			};
		}

		case "save-conflict":
			return {
				...state,
				dirty: true,
				status: "conflict",
				conflict: { loading: true, latestUpdatedAt: null, error: null },
			};

		case "external-change":
			// An external edit never replaces the in-memory draft; it opens the same explicit reload/keep choices.
			return {
				...state,
				status: "conflict",
				conflict: { loading: true, latestUpdatedAt: null, error: null },
			};

		case "conflict-details":
			if (state.status !== "conflict") return state;
			return {
				...state,
				conflict: {
					loading: false,
					latestUpdatedAt: action.latestUpdatedAt ?? null,
					error: action.error ?? null,
				},
			};

		case "keep-editing":
			return state.status === "conflict" ? { ...state, status: "idle", conflict: null } : state;

		case "save-error":
			return { ...state, status: "error", conflict: null };

		case "clear-error":
			return state.status === "error" ? { ...state, status: state.dirty ? "idle" : "saved" } : state;

		case "load-error":
			return { ...state, status: "error" };

		case "reset":
			return initialEditorState;
	}
};
