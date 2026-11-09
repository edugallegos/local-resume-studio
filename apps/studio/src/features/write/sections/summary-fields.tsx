import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumeEdit } from "../resume-edits";
import { TextField } from "./field-controls";
import { SanitizedRichText } from "./rich-text";
import { SectionHeadingField } from "./section-heading-field";

export type SummaryFieldsProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
};

export function SummaryFields({ data, onEdit }: SummaryFieldsProps) {
	const heading = getResumeSectionTitle(data, "summary");

	return (
		<section aria-labelledby="write-summary-title" className="border-b border-line pb-6">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3 id="write-summary-title" className="text-sm font-semibold text-ink">
					{heading}
				</h3>
				<p className="text-xs text-ink-3">Imported formatting is previewed safely; scripts and media are removed.</p>
			</div>

			<div className="mt-3 grid gap-3">
				<SectionHeadingField
					id="write-summary-heading"
					label="Summary heading"
					section="summary"
					data={data}
					onEdit={onEdit}
				/>
				<div>
					<TextField
						id="write-summary-content"
						label="Summary content"
						multiline
						value={data.summary.content}
						placeholder="<p>A short professional summary.</p>"
						hint="Stored as HTML. Only formatting is previewed below; the stored content stays exactly as entered."
						onChange={(value) => onEdit({ type: "update-summary", field: "content", value })}
					/>
					<SanitizedRichText html={data.summary.content} label="Summary formatted preview" />
				</div>
			</div>
		</section>
	);
}
