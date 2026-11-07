import type { ResumeData } from "@reactive-resume/schema/resume/data";
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

			<BasicsFields data={data} onEdit={onEdit} />
			<SummaryFields data={data} onEdit={onEdit} />

			{editableSections.map((section) => (
				<SectionEditor key={section} section={section} data={data} onEdit={onEdit} />
			))}
		</div>
	);
}
