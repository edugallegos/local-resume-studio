import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { describe, expect, it } from "vitest";
import { type EditorState, editorReducer, initialEditorState } from "./editor-state";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (name = "Ada Lovelace"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = name;
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic summary used by editor-state tests.</p>";
	return data;
};

const loadedState = (): EditorState => ({
	selectedId: "ada-lovelace",
	data: syntheticResume(),
	etag: "etag-1",
	dirty: false,
	status: "saved",
});

describe("editorReducer", () => {
	it("starts idle with no selected resume", () => {
		expect(initialEditorState).toEqual({
			selectedId: null,
			data: null,
			etag: null,
			dirty: false,
			status: "idle",
		});
	});

	it("loads a selected resume as clean and saved", () => {
		const data = syntheticResume();
		const state = editorReducer(initialEditorState, {
			type: "load",
			selectedId: "ada-lovelace",
			data,
			etag: "etag-1",
		});

		expect(state).toEqual({
			selectedId: "ada-lovelace",
			data,
			etag: "etag-1",
			dirty: false,
			status: "saved",
		});
	});

	it("marks edited drafts without mutating the previous state", () => {
		const previous = loadedState();
		const previousData = previous.data;
		const draft = syntheticResume("Ada Draft");

		const state = editorReducer(previous, { type: "edit", data: draft });

		expect(state.data).toBe(draft);
		expect(state.dirty).toBe(true);
		expect(state.status).toBe("idle");
		expect(state.selectedId).toBe("ada-lovelace");
		expect(state.etag).toBe("etag-1");
		expect(previous.data).toBe(previousData);
		expect(previous.dirty).toBe(false);
	});

	it("marks saving and then updates the base document after a successful save", () => {
		const draft = syntheticResume("Ada Draft");
		const edited = editorReducer(loadedState(), { type: "edit", data: draft });

		const saving = editorReducer(edited, { type: "save-start" });
		expect(saving.status).toBe("saving");
		expect(saving.dirty).toBe(true);
		expect(saving.data).toBe(draft);

		const savedData = syntheticResume("Ada Saved");
		const saved = editorReducer(saving, { type: "save-success", data: savedData, etag: "etag-2" });
		expect(saved.status).toBe("saved");
		expect(saved.dirty).toBe(false);
		expect(saved.data).toBe(savedData);
		expect(saved.etag).toBe("etag-2");
	});

	it("keeps the unsaved draft, selection, and dirty flag after a save conflict", () => {
		const draft = syntheticResume("Ada Draft Kept");
		const edited = editorReducer(loadedState(), { type: "edit", data: draft });

		const conflicted = editorReducer(edited, { type: "save-conflict" });

		expect(conflicted.status).toBe("conflict");
		expect(conflicted.dirty).toBe(true);
		expect(conflicted.selectedId).toBe("ada-lovelace");
		expect(conflicted.etag).toBe("etag-1");
		expect(conflicted.data).toBe(draft);
		expect(conflicted.data?.basics.name).toBe("Ada Draft Kept");
	});

	it("reports a load failure without discarding the current draft", () => {
		const data = syntheticResume("Ada Kept");
		const state = { ...loadedState(), data, dirty: true, status: "idle" as const };

		const failed = editorReducer(state, { type: "load-error" });

		expect(failed.status).toBe("error");
		expect(failed.data).toBe(data);
		expect(failed.dirty).toBe(true);
		expect(failed.selectedId).toBe("ada-lovelace");
	});
});
