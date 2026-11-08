import { useState } from "react";
import type { EditableSection, ResumeEdit } from "../resume-edits";
import { writeItemFieldId } from "../write-focus";
import { ExperienceRoles } from "./experience-roles";
import { NumberField, TextField } from "./field-controls";
import { SanitizedRichText } from "./rich-text";

export type SectionFieldKind = "text" | "url" | "textarea" | "number" | "keywords" | "rich" | "date";

export type SectionField = {
	key: string;
	label: string;
	kind?: SectionFieldKind;
	placeholder?: string;
	hint?: string;
};

export type ItemEditorProps = {
	section: EditableSection;
	item: Record<string, unknown>;
	index: number;
	singular: string;
	fields: SectionField[];
	onEdit: (edit: ResumeEdit) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const fieldValue = (item: Record<string, unknown>, key: string): string => {
	if (key === "website.url") {
		return isRecord(item.website) && typeof item.website.url === "string" ? item.website.url : "";
	}
	if (key === "website.label") {
		return isRecord(item.website) && typeof item.website.label === "string" ? item.website.label : "";
	}
	const value = item[key];
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "number") return String(value);
	return typeof value === "string" ? value : "";
};

const changesFor = (item: Record<string, unknown>, field: SectionField, value: string): Record<string, unknown> => {
	switch (field.kind) {
		case "number": {
			const numeric = Number(value);
			return { [field.key]: Number.isFinite(numeric) ? Math.min(5, Math.max(0, Math.trunc(numeric))) : 0 };
		}

		case "keywords":
			return {
				[field.key]: value
					.split(",")
					.map((keyword) => keyword.trim())
					.filter((keyword) => keyword !== ""),
			};

		case "rich":
		case "textarea":
			return { [field.key]: value };

		case "date": {
			const dates: Record<string, unknown> = isRecord(item.dates)
				? { ...item.dates }
				: { start: null, end: null, present: false };
			if (value.trim() === "") delete dates.raw;
			else dates.raw = value;
			return { [field.key]: value, dates };
		}

		default:
			if (field.key === "website.url" || field.key === "website.label") {
				const current = isRecord(item.website) ? item.website : { url: "", label: "", inlineLink: false };
				return { website: { ...current, [field.key.slice("website.".length)]: value } };
			}
			return { [field.key]: value };
	}
};

const idFor = (section: EditableSection, item: Record<string, unknown>, key: string): string =>
	writeItemFieldId(section, String(item.id ?? "item"), key);

/**
 * Keeps the comma-separated draft exactly as typed while the document stores a clean array.
 * Without local text, the controlled input would normalize away a trailing comma on each keypress.
 */
function KeywordsField({
	id,
	label,
	value,
	hint,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	hint?: string;
	onChange: (value: string) => void;
}) {
	const [text, setText] = useState(value);
	return (
		<TextField
			id={id}
			label={label}
			value={text}
			hint={hint}
			onChange={(next) => {
				setText(next);
				onChange(next);
			}}
		/>
	);
}

export function ItemEditor({ section, item, index, singular, fields, onEdit }: ItemEditorProps) {
	const roles =
		section === "experience" && Array.isArray(item.roles)
			? item.roles.filter(
					(role): role is Record<string, unknown> =>
						typeof role === "object" && role !== null && !Array.isArray(role),
				)
			: [];

	return (
		<div className="grid gap-4">
			<div className="grid gap-3 sm:grid-cols-2">
				{fields.map((field) => {
					const id = idFor(section, item, field.key);
					const label = `${singular} ${index + 1}: ${field.label}`;
					const value = fieldValue(item, field.key);
					const update = (next: string): void => {
						onEdit({ type: "update-item", section, id: String(item.id), changes: changesFor(item, field, next) });
					};

					if (field.kind === "number") {
						return (
							<NumberField
								key={field.key}
								id={id}
								label={label}
								value={Number(value) || 0}
								hint={field.hint}
								onChange={(next) => update(String(next))}
							/>
						);
					}

					if (field.kind === "keywords") {
						return (
							<KeywordsField
								key={field.key}
								id={id}
								label={label}
								value={value}
								hint={field.hint}
								onChange={update}
							/>
						);
					}

					return (
						<div
							key={field.key}
							className={field.kind === "rich" || field.kind === "textarea" ? "sm:col-span-2" : ""}
						>
							<TextField
								id={id}
								label={label}
								type={field.kind === "url" ? "url" : "text"}
								multiline={field.kind === "rich" || field.kind === "textarea"}
								value={value}
								placeholder={field.placeholder}
								hint={field.hint}
								onChange={update}
							/>
							{field.kind === "rich" ? (
								<SanitizedRichText html={value} label={`${label} formatted preview`} />
							) : null}
						</div>
					);
				})}
			</div>

			{section === "experience" ? (
				<ExperienceRoles
					experienceId={String(item.id)}
					experienceIndex={index}
					roles={roles}
					onEdit={onEdit}
				/>
			) : null}
		</div>
	);
}
