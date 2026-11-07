import type { ResumeListItem, StoredResume } from "@local-resume/store/types";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import type { ResumeApiClient } from "../../api/client";

export type ResumeLibraryProps = {
	client: ResumeApiClient;
	/** The resume currently open in the editor, used for the raw JSON export action. */
	selectedId?: string | null;
	onOpen: (resume: StoredResume) => void;
	onCreated?: (resume: StoredResume) => void;
	onDuplicated?: (resume: StoredResume) => void;
	onRenamed?: (resume: StoredResume, previousId: string) => void;
	onDeleted?: (id: string) => void;
	onImported?: (resume: StoredResume) => void;
	/** Injected by tests and by any future shell that wants its own confirmation UI. */
	confirmDelete?: (resume: ResumeListItem) => boolean | Promise<boolean>;
	/** Injected by tests so export stays deterministic and never touches the browser download API. */
	downloadJson?: (filename: string, contents: string) => void;
};

type FormState =
	| { type: "create" }
	| { type: "duplicate"; resume: ResumeListItem }
	| { type: "rename"; resume: ResumeListItem };

const formCopy = {
	create: {
		title: "Create resume",
		submit: "Create resume",
		hint: "Starts from the pinned Reactive Resume v6.1.0 default document.",
	},
	duplicate: {
		title: "Duplicate resume",
		submit: "Duplicate resume",
		hint: "The new file keeps the same content, with its own local label.",
	},
	rename: {
		title: "Rename resume",
		submit: "Rename resume",
		hint: "The label becomes the lowercase JSON file-name slug.",
	},
} as const;

const displayName = (resume: ResumeListItem): string => resume.fullName.trim() || resume.label;

const formatUpdatedAt = (value: string): string => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const messageOf = (error: unknown): string => {
	if (error instanceof Error && error.message.trim() !== "") return error.message;
	return "The resume library request failed.";
};

const confirmDeleteInBrowser = (resume: ResumeListItem): boolean => {
	if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
	return window.confirm(`Delete "${displayName(resume)}"? This removes its local JSON file.`);
};

const downloadJsonFile = (filename: string, contents: string): void => {
	const blob = new Blob([contents], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
};

export function ResumeLibrary({
	client,
	selectedId = null,
	onOpen,
	onCreated,
	onDuplicated,
	onRenamed,
	onDeleted,
	onImported,
	confirmDelete = confirmDeleteInBrowser,
	downloadJson = downloadJsonFile,
}: ResumeLibraryProps) {
	const [resumes, setResumes] = useState<ResumeListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState<FormState | null>(null);
	const [label, setLabel] = useState("");

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setResumes(await client.list());
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setLoading(false);
		}
	}, [client]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const closeForm = (): void => {
		setForm(null);
		setLabel("");
	};

	const openForm = (nextForm: FormState, nextLabel: string): void => {
		setError(null);
		setForm(nextForm);
		setLabel(nextLabel);
	};

	const openResume = async (resume: ResumeListItem): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			onOpen(await client.read(resume.id));
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	};

	const submitForm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		const nextLabel = label.trim();
		if (!form || nextLabel === "") return;

		setBusy(true);
		setError(null);

		try {
			if (form.type === "create") {
				const created = await client.create(nextLabel, structuredClone(defaultResumeData));
				closeForm();
				await refresh();
				onCreated?.(created);
			} else if (form.type === "duplicate") {
				const duplicated = await client.duplicate(form.resume.id, nextLabel);
				closeForm();
				await refresh();
				onDuplicated?.(duplicated);
			} else {
				const current = await client.read(form.resume.id);
				const renamed = await client.rename(form.resume.id, nextLabel, current.etag);
				closeForm();
				await refresh();
				onRenamed?.(renamed, form.resume.id);
			}
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	};

	const deleteResume = async (resume: ResumeListItem): Promise<void> => {
		setError(null);
		if (!(await Promise.resolve(confirmDelete(resume)))) return;

		setBusy(true);
		try {
			const current = await client.read(resume.id);
			await client.remove(resume.id, current.etag);
			await refresh();
			onDeleted?.(resume.id);
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	};

	const importResume = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (!file) return;

		setBusy(true);
		setError(null);

		try {
			let parsed: unknown;
			try {
				parsed = JSON.parse(await file.text());
			} catch {
				throw new Error("The selected file is not valid JSON.");
			}

			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				throw new Error("The selected file must contain a standard Reactive Resume JSON object.");
			}

			const importedLabel = file.name.replace(/\.json$/i, "").trim() || "imported-resume";
			const imported = await client.create(importedLabel, parsed as ResumeData);
			await refresh();
			onImported?.(imported);
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	};

	const exportSelected = async (): Promise<void> => {
		if (!selectedId) return;

		setBusy(true);
		setError(null);
		try {
			const resume = await client.read(selectedId);
			// The download is the raw standard resume object, not an app-specific wrapper.
			downloadJson(`${resume.label || resume.id}.json`, `${JSON.stringify(resume.data, null, 2)}\n`);
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	};

	const copy = form ? formCopy[form.type] : null;

	return (
		<section aria-labelledby="resume-library-title" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
			<div className="flex flex-col gap-6">
				<header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
					<div className="max-w-2xl">
						<p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-3">Local library</p>
						<h1 id="resume-library-title" className="mt-1 font-display text-3xl leading-tight text-ink sm:text-4xl">
							Your resumes, on this desk
						</h1>
						<p className="mt-2 text-sm leading-6 text-ink-2">
							Each file is standard Reactive Resume JSON under your local data directory. Open one to edit it, or
							import a v6.1.0 document without adding any wrapper.
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button variant="primary" onClick={() => openForm({ type: "create" }, "")} disabled={busy}>
							<Icon name="plus" />
							New resume
						</Button>

						<label
							htmlFor="resume-library-import"
							className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line-2 bg-surface px-3.5 text-sm font-medium text-ink transition-colors duration-quick hover:bg-sunken"
						>
							<Icon name="file-arrow-up" />
							Import JSON
						</label>
						<input
							id="resume-library-import"
							type="file"
							accept="application/json,.json"
							aria-label="Import resume JSON"
							className="sr-only"
							onChange={(event) => void importResume(event)}
						/>

						<Button variant="secondary" onClick={() => void exportSelected()} disabled={!selectedId || busy}>
							<Icon name="download-simple" />
							Export selected JSON
						</Button>
					</div>
				</header>

				{error ? (
					<div
						role="alert"
						className="flex items-start gap-3 rounded-lg border border-danger bg-danger-soft px-4 py-3 text-sm text-danger-text"
					>
						<Icon name="warning-circle" className="mt-0.5" />
						<p className="leading-5">{error}</p>
					</div>
				) : null}

				{copy ? (
					<form
						aria-label={copy.title}
						onSubmit={(event) => void submitForm(event)}
						className="rounded-lg border border-line bg-surface p-4 shadow-e1"
					>
						<div className="flex flex-wrap items-end gap-3">
							<div className="min-w-[14rem] flex-1">
								<label htmlFor="resume-library-label" className="block text-xs font-medium text-ink-2">
									Resume label
								</label>
								<input
									id="resume-library-label"
									name="label"
									value={label}
									onChange={(event) => setLabel(event.target.value)}
									placeholder="e.g. ada-lovelace"
									className="mt-1 h-9 w-full rounded-md border border-control-border bg-raised px-3 text-sm text-ink placeholder:text-ink-3"
								/>
							</div>
							<Button type="submit" loading={busy} disabled={label.trim() === ""}>
								{copy.submit}
							</Button>
							<Button type="button" variant="ghost" onClick={closeForm} disabled={busy}>
								Cancel
							</Button>
						</div>
						<p className="mt-2 text-xs leading-5 text-ink-3">{copy.hint}</p>
					</form>
				) : null}

				<div className="overflow-hidden rounded-lg border border-line bg-surface shadow-e1">
					<div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
						<h2 className="text-sm font-semibold text-ink">Local resumes</h2>
						{loading ? null : (
							<span className="text-xs text-ink-3">
								{resumes.length} {resumes.length === 1 ? "resume" : "resumes"}
							</span>
						)}
					</div>

					{loading ? (
						<div role="status" className="flex items-center gap-3 px-4 py-10 text-sm text-ink-2">
							<Spinner decorative />
							<span>Loading resumes from the local data directory…</span>
						</div>
					) : error && resumes.length === 0 ? (
						<div className="flex flex-col items-start gap-3 px-4 py-10 sm:px-6">
							<span className="flex size-10 items-center justify-center rounded-lg bg-danger-soft text-danger-text">
								<Icon name="warning-circle" size={22} />
							</span>
							<div>
								<h3 className="text-base font-semibold text-ink">Could not load the library</h3>
								<p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
									The local API error is shown above. Your files were not changed; retry when the local server is
									ready.
								</p>
							</div>
							<Button variant="secondary" onClick={() => void refresh()} disabled={busy}>
								Try again
							</Button>
						</div>
					) : resumes.length === 0 ? (
						<div className="flex flex-col items-start gap-3 px-4 py-10 sm:px-6">
							<span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
								<Icon name="file-plus" size={22} />
							</span>
							<div>
								<h3 className="text-base font-semibold text-ink">No resumes yet</h3>
								<p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
									Create a blank resume or import a standard Reactive Resume JSON file. Nothing is uploaded; the
									files stay in your local data directory.
								</p>
							</div>
						</div>
					) : (
						<ul className="divide-y divide-line">
							{resumes.map((resume) => {
								const active = selectedId === resume.id;
								return (
									<li
										key={resume.id}
										className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
									>
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<button
													type="button"
													onClick={() => void openResume(resume)}
													aria-label={`Open ${displayName(resume)}`}
													aria-current={active ? "true" : undefined}
													className="truncate text-left text-sm font-semibold text-ink underline-offset-4 hover:underline"
												>
													{displayName(resume)}
												</button>
												{active ? <Badge variant="accent">Active</Badge> : null}
											</div>
											<p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
												<span className="font-mono">{resume.label}</span>
												<span aria-hidden="true">·</span>
												<span>
													Updated{" "}
													<time dateTime={resume.updatedAt}>{formatUpdatedAt(resume.updatedAt)}</time>
												</span>
											</p>
										</div>

										<div className="flex flex-wrap items-center gap-1">
											<Button
												size="sm"
												variant="ghost"
												onClick={() => openForm({ type: "duplicate", resume }, `${resume.label} copy`)}
												aria-label={`Duplicate ${displayName(resume)}`}
												disabled={busy}
											>
												Duplicate
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => openForm({ type: "rename", resume }, resume.label)}
												aria-label={`Rename ${displayName(resume)}`}
												disabled={busy}
											>
												Rename
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => void deleteResume(resume)}
												aria-label={`Delete ${displayName(resume)}`}
												disabled={busy}
												className="text-danger-text hover:bg-danger-soft"
											>
												Delete
											</Button>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-3">
					<span className="inline-flex items-center gap-1.5">
						<Icon name="file-text" className="text-ink-3" />
						Stored locally as standard JSON
					</span>
					<Separator orientation="vertical" className="h-4" />
					<span>External edits are protected by ETags when you save.</span>
				</div>
			</div>
		</section>
	);
}
