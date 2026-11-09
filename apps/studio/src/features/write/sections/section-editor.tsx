import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon, type IconName } from "@reactive-resume/ui/components/icon";
import type { EditableSection, ResumeEdit } from "../resume-edits";
import { writeSectionHeadingId } from "../write-focus";
import { ItemEditor, type SectionField } from "./item-editor";
import { SectionHeadingField } from "./section-heading-field";

export type SectionDefinition = {
	title: string;
	singular: string;
	icon: IconName;
	description: string;
	fields: SectionField[];
};

const websiteFields: SectionField[] = [
	{ key: "website.url", label: "Website URL", kind: "url", placeholder: "https://example.test" },
	{ key: "website.label", label: "Website label", placeholder: "Optional display label" },
];

const rangeDateField: SectionField = {
	key: "period",
	label: "Period",
	kind: "date",
	hint: "Custom date text overrides the structured dates without erasing them.",
};

export const sectionDefinitions: Record<EditableSection, SectionDefinition> = {
	profiles: {
		title: "Profiles",
		singular: "profile",
		icon: "user-circle",
		description: "Networks and public profiles shown with your contact details.",
		fields: [
			{ key: "network", label: "Network", placeholder: "GitHub" },
			{ key: "username", label: "Username" },
			...websiteFields,
		],
	},
	experience: {
		title: "Experience",
		singular: "experience",
		icon: "briefcase",
		description: "Roles, organizations, and the impact you had there.",
		fields: [
			{ key: "company", label: "Company" },
			{ key: "position", label: "Position" },
			{ key: "location", label: "Location" },
			rangeDateField,
			...websiteFields,
			{ key: "description", label: "Description", kind: "rich", hint: "Stored as HTML. Only formatting is previewed." },
		],
	},
	education: {
		title: "Education",
		singular: "education",
		icon: "graduation-cap",
		description: "Schools, degrees, and areas of study.",
		fields: [
			{ key: "school", label: "School" },
			{ key: "degree", label: "Degree" },
			{ key: "area", label: "Area of study" },
			{ key: "grade", label: "Grade" },
			{ key: "location", label: "Location" },
			rangeDateField,
			...websiteFields,
			{ key: "description", label: "Description", kind: "rich", hint: "Stored as HTML. Only formatting is previewed." },
		],
	},
	projects: {
		title: "Projects",
		singular: "project",
		icon: "code",
		description: "Selected builds, case studies, and personal work.",
		fields: [
			{ key: "name", label: "Project name" },
			rangeDateField,
			...websiteFields,
			{ key: "description", label: "Description", kind: "rich", hint: "Stored as HTML. Only formatting is previewed." },
		],
	},
	skills: {
		title: "Skills",
		singular: "skill",
		icon: "compass",
		description: "Capabilities with an optional proficiency and keyword list.",
		fields: [
			{ key: "name", label: "Skill" },
			{ key: "proficiency", label: "Proficiency", placeholder: "Advanced" },
			{ key: "level", label: "Level (0–5)", kind: "number", hint: "0 hides the level indicator." },
			{ key: "keywords", label: "Keywords", kind: "keywords", hint: "Separate keywords with commas." },
		],
	},
	languages: {
		title: "Languages",
		singular: "language",
		icon: "translate",
		description: "Spoken and written languages and their fluency.",
		fields: [
			{ key: "language", label: "Language" },
			{ key: "fluency", label: "Fluency", placeholder: "Fluent" },
			{ key: "level", label: "Level (0–5)", kind: "number", hint: "0 hides the level indicator." },
		],
	},
	certifications: {
		title: "Certifications",
		singular: "certification",
		icon: "seal-check",
		description: "Credentials, issuers, and the date they were earned.",
		fields: [
			{ key: "title", label: "Certification title" },
			{ key: "issuer", label: "Issuer" },
			{
				key: "date",
				label: "Date",
				kind: "date",
				hint: "Custom date text overrides the structured date without erasing it.",
			},
			...websiteFields,
			{ key: "description", label: "Description", kind: "rich", hint: "Stored as HTML. Only formatting is previewed." },
		],
	},
};

export type SectionEditorProps = {
	section: EditableSection;
	data: ResumeData;
	onEdit: (edit: ResumeEdit) => void;
};

export function SectionEditor({ section, data, onEdit }: SectionEditorProps) {
	const definition = sectionDefinitions[section];
	const items = (data.sections[section] as unknown as { items: Record<string, unknown>[] }).items;
	const titleId = writeSectionHeadingId(section);
	const heading = getResumeSectionTitle(data, section);
	const headingLabel = `${definition.title} heading`;
	const plural = items.length === 1 ? definition.singular : `${definition.singular}s`;

	return (
		<section aria-labelledby={titleId} className="border-b border-line pb-6 last:border-b-0 last:pb-0">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3
						id={titleId}
						tabIndex={-1}
						className="flex items-center gap-2 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						<Icon name={definition.icon} className="text-ink-3" />
						{heading}
					</h3>
					<p className="mt-1 text-xs leading-5 text-ink-3">{definition.description}</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-ink-3">
						{items.length} {plural}
					</span>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => onEdit({ type: "add-item", section })}
						aria-label={`Add ${definition.singular}`}
					>
						<Icon name="plus" />
						Add
					</Button>
				</div>
			</div>

			<div className="mt-3">
				<SectionHeadingField
					id={`write-${section}-heading`}
					label={headingLabel}
					section={section}
					data={data}
					onEdit={onEdit}
				/>
			</div>

			{items.length === 0 ? (
				<p className="mt-4 rounded-md border border-dashed border-line-2 bg-sunken/40 px-3 py-4 text-sm text-ink-3">
					No {definition.singular} entries yet. Use Add to create one.
				</p>
			) : (
				<ol className="mt-4 grid gap-3">
					{items.map((item, index) => (
						<li key={String(item.id)} className="rounded-md border border-line bg-sunken/30 p-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
									{definition.singular} {index + 1}
								</p>
								<div className="flex items-center gap-1">
									<Button
										size="icon-xs"
										variant="ghost"
										aria-label={`Move ${definition.singular} ${index + 1} up`}
										disabled={index === 0}
										onClick={() => onEdit({ type: "move-item", section, id: String(item.id), toIndex: index - 1 })}
									>
										<Icon name="arrow-up" />
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										aria-label={`Move ${definition.singular} ${index + 1} down`}
										disabled={index === items.length - 1}
										onClick={() => onEdit({ type: "move-item", section, id: String(item.id), toIndex: index + 1 })}
									>
										<Icon name="arrow-down" />
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										className="text-danger-text hover:bg-danger-soft"
										aria-label={`Remove ${definition.singular} ${index + 1}`}
										onClick={() => onEdit({ type: "remove-item", section, id: String(item.id) })}
									>
										<Icon name="trash" />
									</Button>
								</div>
							</div>

							<div className="mt-3">
								<ItemEditor
									section={section}
									item={item}
									index={index}
									singular={definition.singular}
									fields={definition.fields}
									onEdit={onEdit}
								/>
							</div>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
