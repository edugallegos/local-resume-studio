import { cn } from "@reactive-resume/utils/style";
import { useEffect, useState } from "react";

export const fieldClass =
	"w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-sm text-ink shadow-none focus-visible:outline-2 focus-visible:outline-accent";

type NumberInputProps = {
	value: number;
	onValueChange: (value: number) => void;
	label: string;
	min?: number;
	max?: number;
	step?: number;
	className?: string;
};

/**
 * A controlled numeric input that keeps the user's raw text while they edit. Clearing it never snaps back to
 * the minimum, so typing "38" after selecting all commits 38 rather than a clamped intermediate value.
 */
export function NumberInput({ value, onValueChange, label, min, max, step, className }: NumberInputProps) {
	const [text, setText] = useState(String(value));
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!editing) setText(String(value));
	}, [editing, value]);

	return (
		<input
			type="number"
			aria-label={label}
			className={cn(fieldClass, className)}
			value={text}
			min={min}
			max={max}
			step={step}
			onFocus={() => setEditing(true)}
			onBlur={() => {
				setEditing(false);
				setText(String(value));
			}}
			onChange={(event) => {
				const raw = event.target.value;
				setText(raw);
				if (raw.trim() === "") return;
				const parsed = Number(raw);
				if (Number.isFinite(parsed)) onValueChange(parsed);
			}}
		/>
	);
}
