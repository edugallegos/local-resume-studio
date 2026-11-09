import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { LocaleSelect } from "../locale-select";
import type { EditableSection, ResumeEdit } from "./resume-edits";
import { BasicsFields } from "./sections/basics-fields";
import { SectionEditor } from "./sections/section-editor";
import { SummaryFields } from "./sections/summary-fields";

const editableSections: EditableSection[] = [
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"certifications",
];

export type WritePanelProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
};

/**
 * Native editing controls for the core resume sections. Every input dispatches a single edit;
 * the parent reducer applies it immutably, so unsupported sections and unknown keys survive.
 */
export function WritePanel({ data, onEdit }: WritePanelProps) {
	return (
		<div className="flex flex-col gap-6">
			<p className="text-sm leading-6 text-ink-2">
				Edit the core resume content here. Imported HTML is previewed with a formatting-only allowlist, and fields
				you do not edit stay exactly as they are stored.
			</p>

			<section aria-labelledby="write-language-title" className="border-b border-line pb-6">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h3 id="write-language-title" className="text-sm font-semibold text-ink">
						Language
					</h3>
					<p className="text-xs text-ink-3">The output language for built-in headings and dates.</p>
				</div>
				<div className="mt-3 max-w-sm">
					<LocaleSelect
						id="write-resume-locale"
						value={data.metadata.page.locale}
						onChange={(locale) => onEdit({ type: "update-page", changes: { locale } })}
					/>
				</div>
			</section>

			<BasicsFields data={data} onEdit={onEdit} />
			<SummaryFields data={data} onEdit={onEdit} />

			{editableSections.map((section) => (
				<SectionEditor key={section} section={section} data={data} onEdit={onEdit} />
			))}
		</div>
	);
}
