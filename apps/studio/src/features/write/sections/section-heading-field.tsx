import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumeEdit, SectionTitleSection } from "../resume-edits";
import { TextField } from "./field-controls";

export type SectionHeadingFieldProps = {
	id: string;
	label: string;
	section: SectionTitleSection;
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
};

const storedTitle = (data: ResumeData, section: SectionTitleSection): string =>
	section === "summary"
		? data.summary.title
		: (data.sections[section] as unknown as { title: string }).title;

/**
 * A section heading is ordinary resume content: the stored title wins, and an empty title asks the
 * pinned PDF resolver for the current locale's default. Reset therefore clears the title instead of
 * copying today's translation into the file.
 */
export function SectionHeadingField({ id, label, section, data, onEdit }: SectionHeadingFieldProps) {
	const value = storedTitle(data, section);
	const fallback = getResumeSectionTitle(data, section);
	const hasCustomTitle = value.trim() !== "";
	const edit = (next: string) => onEdit({ type: "update-section-title", section, value: next });

	return (
		<div className="min-w-0">
			<TextField
				id={id}
				label={label}
				value={value}
				placeholder={fallback}
				hint="Leave blank to use this language's default heading."
				onChange={edit}
			/>
			<div className="mt-2">
				<button
					type="button"
					className="rounded-sm border border-line-2 px-2.5 py-1 text-xs text-ink-2 hover:bg-hover disabled:opacity-40"
					aria-label={`Reset ${label} to default`}
					disabled={!hasCustomTitle}
					onClick={() => edit("")}
				>
					Use default heading
				</button>
			</div>
		</div>
	);
}
