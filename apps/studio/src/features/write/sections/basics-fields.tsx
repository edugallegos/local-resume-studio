import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { BasicsField, ResumeEdit } from "../resume-edits";
import { TextField } from "./field-controls";

export type BasicsFieldsProps = {
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
};

const fields: { field: Exclude<BasicsField, "website.url" | "website.label">; label: string; type?: "email" | "tel" }[] = [
	{ field: "name", label: "Full name" },
	{ field: "headline", label: "Headline" },
	{ field: "email", label: "Email", type: "email" },
	{ field: "phone", label: "Phone", type: "tel" },
	{ field: "location", label: "Location" },
];

export function BasicsFields({ data, onEdit }: BasicsFieldsProps) {
	return (
		<section aria-labelledby="write-basics-title" className="border-b border-line pb-6">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3 id="write-basics-title" className="text-sm font-semibold text-ink">
					Basics
				</h3>
				<p className="text-xs text-ink-3">Name and contact details used by every template.</p>
			</div>

			<div className="mt-3 grid gap-3 sm:grid-cols-2">
				{fields.map(({ field, label, type }) => (
					<TextField
						key={field}
						id={`write-basics-${field}`}
						label={label}
						type={type}
						value={data.basics[field]}
						onChange={(value) => onEdit({ type: "update-basics", field, value })}
					/>
				))}

				<div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
					<TextField
						id="write-basics-website-url"
						label="Website URL"
						type="url"
						value={data.basics.website.url}
						placeholder="https://example.test"
						onChange={(value) => onEdit({ type: "update-basics", field: "website.url", value })}
					/>
					<TextField
						id="write-basics-website-label"
						label="Website label"
						value={data.basics.website.label}
						placeholder="Shown instead of the URL"
						onChange={(value) => onEdit({ type: "update-basics", field: "website.label", value })}
					/>
				</div>
			</div>
		</section>
	);
}
