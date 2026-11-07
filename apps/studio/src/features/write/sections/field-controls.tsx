import type { ReactNode } from "react";

const inputClass =
	"mt-1 h-9 w-full rounded-md border border-control-border bg-raised px-3 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

const textareaClass =
	"mt-1 min-h-24 w-full rounded-md border border-control-border bg-raised px-3 py-2 text-sm leading-6 text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

type FieldShellProps = {
	id: string;
	label: string;
	hint?: string;
	children: ReactNode;
};

export function FieldShell({ id, label, hint, children }: FieldShellProps) {
	return (
		<div className="min-w-0">
			<label htmlFor={id} className="block text-xs font-medium text-ink-2">
				{label}
			</label>
			{children}
			{hint ? <p className="mt-1 text-xs leading-5 text-ink-3">{hint}</p> : null}
		</div>
	);
}

export type TextFieldProps = {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	hint?: string;
	type?: "text" | "email" | "tel" | "url";
	multiline?: boolean;
};

export function TextField({
	id,
	label,
	value,
	onChange,
	placeholder,
	hint,
	type = "text",
	multiline = false,
}: TextFieldProps) {
	return (
		<FieldShell id={id} label={label} hint={hint}>
			{multiline ? (
				<textarea
					id={id}
					value={value}
					placeholder={placeholder}
					onChange={(event) => onChange(event.target.value)}
					className={textareaClass}
				/>
			) : (
				<input
					id={id}
					type={type}
					value={value}
					placeholder={placeholder}
					onChange={(event) => onChange(event.target.value)}
					className={inputClass}
				/>
			)}
		</FieldShell>
	);
}

export function NumberField({
	id,
	label,
	value,
	onChange,
	hint,
}: {
	id: string;
	label: string;
	value: number;
	onChange: (value: number) => void;
	hint?: string;
}) {
	return (
		<FieldShell id={id} label={label} hint={hint}>
			<input
				id={id}
				type="number"
				min={0}
				max={5}
				step={1}
				value={value}
				onChange={(event) => {
					const numeric = Number(event.target.value);
					onChange(Number.isFinite(numeric) ? Math.min(5, Math.max(0, Math.trunc(numeric))) : 0);
				}}
				className={inputClass}
			/>
		</FieldShell>
	);
}
