import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import type { ResumeEdit } from "../resume-edits";
import { TextField } from "./field-controls";
import { SanitizedRichText } from "./rich-text";

export type ExperienceRolesProps = {
	experienceId: string;
	experienceIndex: number;
	roles: Record<string, unknown>[];
	onEdit: (edit: ResumeEdit) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (role: Record<string, unknown>, key: string): string =>
	typeof role[key] === "string" ? (role[key] as string) : "";

const dateChanges = (role: Record<string, unknown>, value: string): Record<string, unknown> => {
	const dates: Record<string, unknown> = isRecord(role.dates)
		? { ...role.dates }
		: { start: null, end: null, present: false };
	if (value.trim() === "") delete dates.raw;
	else dates.raw = value;
	return { period: value, dates };
};

const idFor = (experienceId: string, roleId: string, key: string): string => {
	const safeExperience = experienceId.replace(/[^a-zA-Z0-9_-]/g, "-");
	const safeRole = roleId.replace(/[^a-zA-Z0-9_-]/g, "-");
	return `write-experience-${safeExperience}-role-${safeRole}-${key}`;
};

/** Nested career-progression roles inside one experience entry. */
export function ExperienceRoles({ experienceId, experienceIndex, roles, onEdit }: ExperienceRolesProps) {
	const experienceLabel = `experience ${experienceIndex + 1}`;

	return (
		<div className="mt-2 rounded-md border border-line bg-surface/70 p-3 sm:col-span-2">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
						Roles · {experienceLabel}
					</h4>
					<p className="mt-1 text-xs leading-5 text-ink-3">
						Career progression within this experience. Position, dates, and rich text stay nested with their entry.
					</p>
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => onEdit({ type: "add-role", experienceId })}
					aria-label={`Add role to ${experienceLabel}`}
				>
					<Icon name="plus" />
					Add role
				</Button>
			</div>

			{roles.length === 0 ? (
				<p className="mt-3 rounded-md border border-dashed border-line-2 bg-sunken/40 px-3 py-3 text-xs text-ink-3">
					No nested roles yet. Add one to describe progression inside this experience.
				</p>
			) : (
				<ol className="mt-3 grid gap-3">
					{roles.map((role, roleIndex) => {
						const roleId = String(role.id);
						const roleLabel = `role ${roleIndex + 1}`;
						const accessiblePrefix = `Experience ${experienceIndex + 1} ${roleLabel}`;
						const update = (changes: Record<string, unknown>): void => {
							onEdit({ type: "update-role", experienceId, roleId, changes });
						};

						return (
							<li key={roleId} className="rounded-md border border-line bg-sunken/20 p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-xs font-semibold text-ink-2">
										{roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)}
									</p>
									<div className="flex items-center gap-1">
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={`Move ${roleLabel} up in ${experienceLabel}`}
											disabled={roleIndex === 0}
											onClick={() =>
												onEdit({ type: "move-role", experienceId, roleId, toIndex: roleIndex - 1 })
											}
										>
											<Icon name="arrow-up" />
										</Button>
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={`Move ${roleLabel} down in ${experienceLabel}`}
											disabled={roleIndex === roles.length - 1}
											onClick={() =>
												onEdit({ type: "move-role", experienceId, roleId, toIndex: roleIndex + 1 })
											}
										>
											<Icon name="arrow-down" />
										</Button>
										<Button
											size="icon-xs"
											variant="ghost"
											className="text-danger-text hover:bg-danger-soft"
											aria-label={`Remove ${roleLabel} from ${experienceLabel}`}
											onClick={() => onEdit({ type: "remove-role", experienceId, roleId })}
										>
											<Icon name="trash" />
										</Button>
									</div>
								</div>

								<div className="mt-3 grid gap-3 sm:grid-cols-2">
									<TextField
										id={idFor(experienceId, roleId, "position")}
										label={`${accessiblePrefix}: Position`}
										value={textOf(role, "position")}
										placeholder="Senior Analyst"
										onChange={(value) => update({ position: value })}
									/>
									<TextField
										id={idFor(experienceId, roleId, "period")}
										label={`${accessiblePrefix}: Period`}
										value={textOf(role, "period")}
										placeholder="1840 – 1842"
										hint="Custom date text overrides the structured dates without erasing them."
										onChange={(value) => update(dateChanges(role, value))}
									/>
									<div className="sm:col-span-2">
										<TextField
											id={idFor(experienceId, roleId, "description")}
											label={`${accessiblePrefix}: Description`}
											multiline
											value={textOf(role, "description")}
											hint="Stored as HTML. Only formatting is previewed."
											onChange={(value) => update({ description: value })}
										/>
										<SanitizedRichText
											html={textOf(role, "description")}
											label={`${accessiblePrefix}: Description formatted preview`}
										/>
									</div>
								</div>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
