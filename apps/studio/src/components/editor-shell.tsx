import type { StoredResume } from "@local-resume/store/types";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon, type IconName } from "@reactive-resume/ui/components/icon";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import type { ReactNode } from "react";
import type { EditorState } from "../state/editor-state";

export type EditorTab = "write" | "design" | "check";

export type EditorShellProps = {
	state: EditorState;
	resume: StoredResume | null;
	activeTab: EditorTab;
	onTabChange: (tab: EditorTab) => void;
	onBack: () => void;
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
		description:
			"Native editing controls for basics, summary, profiles, experience, education, projects, skills, languages, and certifications arrive in Task 5. The workspace and page layout are ready now.",
		items: ["Basics & summary", "Experience, education, projects", "Skills, languages, certifications"],
	},
	{
		id: "design",
		label: "Design",
		icon: "palette",
		description:
			"Template, typography, density, margins, accent color, section order, and visibility controls arrive in Task 6. The preview column is already persistent.",
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

function SaveState({ state }: { state: EditorState }) {
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
			content = (
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

const SkeletonLine = ({ width = "full" }: { width?: "full" | "long" | "medium" | "short" }) => (
	<span
		className={cn(
			"studio-page__line",
			width === "long" && "studio-page__line--long",
			width === "medium" && "studio-page__line--medium",
			width === "short" && "studio-page__line--short",
		)}
	/>
);

export function EditorShell({ state, resume, activeTab, onTabChange, onBack }: EditorShellProps) {
	const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
	const fullName = state.data?.basics.name.trim() || "Untitled resume";
	const headline = state.data?.basics.headline.trim() || "Add a headline in Write";
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

					<SaveState state={state} />
				</div>
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

					<section
						role="tabpanel"
						id={`editor-panel-${currentTab.id}`}
						aria-labelledby={`editor-tab-${currentTab.id}`}
						className="flex flex-1 flex-col p-5 sm:p-6"
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-3">Workspace</p>
								<h2 className="mt-1 font-display text-2xl leading-tight text-ink">{currentTab.label}</h2>
							</div>
							<Badge variant="info">Placeholder</Badge>
						</div>

						<p className="mt-3 max-w-xl text-sm leading-6 text-ink-2">{currentTab.description}</p>

						<ul className="mt-6 grid gap-3 sm:grid-cols-3">
							{currentTab.items.map((item, index) => (
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
							<span>Controls are intentionally disabled in this task so the shell stays honest.</span>
						</div>
					</section>
				</section>

				<aside
					aria-labelledby="preview-title"
					className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]"
				>
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
						<div>
							<h2 id="preview-title" className="text-sm font-semibold text-ink">
								Page preview
							</h2>
							<p className="mt-0.5 text-xs text-ink-3">The paper area stays visible while you work.</p>
						</div>
						<Badge variant="outline">Preview placeholder</Badge>
					</div>

					<div className="flex flex-1 justify-center overflow-auto bg-sunken p-4 sm:p-8">
						<article className="studio-page" aria-label="Resume page preview">
							<div className="studio-page__masthead">
								<div className="min-w-0">
									<p className="studio-page__eyebrow">Resume preview</p>
									<p className="studio-page__name">{fullName}</p>
									<p className="studio-page__headline">{headline}</p>
								</div>
								<span className="studio-page__avatar" aria-hidden="true">
									LR
								</span>
							</div>

							<div className="studio-page__rule" />

							<div className="studio-page__columns">
								<div className="studio-page__column">
									<p className="studio-page__section-title">Experience</p>
									<div className="studio-page__entry">
										<SkeletonLine width="medium" />
										<SkeletonLine width="short" />
										<SkeletonLine />
										<SkeletonLine width="long" />
									</div>
									<div className="studio-page__entry">
										<SkeletonLine width="medium" />
										<SkeletonLine width="short" />
										<SkeletonLine width="long" />
									</div>
								</div>

								<div className="studio-page__column">
									<p className="studio-page__section-title">Skills</p>
									<div className="studio-page__chips" aria-hidden="true">
										<span />
										<span />
										<span />
										<span />
										<span />
									</div>
									<p className="studio-page__section-title studio-page__section-title--spaced">Education</p>
									<div className="studio-page__entry">
										<SkeletonLine width="medium" />
										<SkeletonLine width="short" />
									</div>
								</div>
							</div>

							<p className="studio-page__note">
								The rendered PDF preview arrives in Task 6. This page reserves the exact preview area used by the
								editor.
							</p>
						</article>
					</div>
				</aside>
			</main>
		</div>
	);
}
