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

	it("stays saving through newer edits and preserves the newer draft after a successful save", () => {
		const submitted = syntheticResume("Ada Submitted");
		const newer = syntheticResume("Ada Newer");
		const edited = editorReducer(
			{ ...loadedState(), data: submitted, dirty: true, status: "idle" },
			{ type: "save-start" },
		);

		const duringSave = editorReducer(edited, { type: "edit", data: newer });

		expect(duringSave.status).toBe("saving");
		expect(duringSave.dirty).toBe(true);
		expect(duringSave.data).toBe(newer);
		expect(duringSave.etag).toBe("etag-1");

		const saved = editorReducer(duringSave, {
			type: "save-success",
			data: submitted,
			etag: "etag-2",
			submittedData: submitted,
		});

		expect(saved.status).toBe("idle");
		expect(saved.dirty).toBe(true);
		expect(saved.data).toBe(newer);
		expect(saved.data?.basics.name).toBe("Ada Newer");
		expect(saved.etag).toBe("etag-2");
		expect(saved.selectedId).toBe("ada-lovelace");
	});

	it("uses the saved response when no edits happened during the save", () => {
		const submitted = syntheticResume("Ada Submitted");
		const savedData = syntheticResume("Ada Saved");
		const saving = editorReducer(
			{ ...loadedState(), data: submitted, dirty: true, status: "idle" },
			{ type: "save-start" },
		);

		const saved = editorReducer(saving, {
			type: "save-success",
			data: savedData,
			etag: "etag-2",
			submittedData: submitted,
		});

		expect(saved.status).toBe("saved");
		expect(saved.dirty).toBe(false);
		expect(saved.data).toBe(savedData);
		expect(saved.etag).toBe("etag-2");
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

	it("keeps the exact draft, ETag, and dirty flag after a non-conflict save error", () => {
		const data = syntheticResume("Ada Save Error");
		const state = { ...loadedState(), data, dirty: true, status: "idle" as const };

		const failed = editorReducer(state, { type: "save-error" });

		expect(failed.status).toBe("error");
		expect(failed.data).toBe(data);
		expect(failed.dirty).toBe(true);
		expect(failed.etag).toBe("etag-1");
		expect(failed.selectedId).toBe("ada-lovelace");
	});
});
