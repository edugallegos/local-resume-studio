import { getLanguageName, supportedLocales, type Locale } from "@reactive-resume/utils/locale";

const selectClass =
	"w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-sm text-ink shadow-none focus-visible:outline-2 focus-visible:outline-accent";

export type LocaleOption = { value: Locale; label: string };

/** Every real pinned locale, named in its own language and identified by code. Pseudo-locales are excluded upstream. */
export const LOCALE_OPTIONS: readonly LocaleOption[] = supportedLocales.map((locale) => ({
	value: locale,
	label: `${getLanguageName(locale)} · ${locale}`,
}));

export type LocaleSelectProps = {
	id: string;
	value: string;
	onChange: (locale: string) => void;
	label?: string;
};

/**
 * The resume's output language. It writes only `metadata.page.locale`; authored content is never translated.
 * The help text is linked with `aria-describedby` and repeated wherever the control appears.
 */
export function LocaleSelect({ id, value, onChange, label = "Resume language" }: LocaleSelectProps) {
	const helpId = `${id}-help`;
	const supported = (supportedLocales as readonly string[]).includes(value);

	return (
		<div className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-2">
			<label htmlFor={id}>{label}</label>
			<select
				id={id}
				className={selectClass}
				value={value}
				aria-describedby={helpId}
				onChange={(event) => onChange(event.target.value)}
			>
				{!supported ? (
					<option value={value}>{value ? `Current (${value})` : "Current (not set)"}</option>
				) : null}
				{LOCALE_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<p id={helpId} className="text-xs font-normal leading-5 text-ink-3">
				Changes default section headings, date words, and text direction. It does not translate your content.
			</p>
		</div>
	);
}
