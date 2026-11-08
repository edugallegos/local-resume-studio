import { contrastOnWhite } from "@reactive-resume/utils/color";

/** Eight accents that stay readable as headings on white. */
export const ACCENTS = [
	{ label: "Moss", hex: "#3E6B4F" },
	{ label: "Ink blue", hex: "#2F5A8A" },
	{ label: "Teal", hex: "#1F6E73" },
	{ label: "Plum", hex: "#6B3E6E" },
	{ label: "Rust", hex: "#A0442A" },
	{ label: "Burgundy", hex: "#8A2C3F" },
	{ label: "Ochre", hex: "#7A5A12" },
	{ label: "Graphite", hex: "#3B3F45" },
] as const;

const HEX = /^#?([0-9a-f]{6})$/i;

export const hexToRgba = (hex: string): string => {
	const normalized = normalizeHex(hex);
	const value = Number.parseInt(HEX.exec(normalized ?? "")?.[1] ?? "000000", 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, 1)`;
};

/** The hex of an `rgba(r, g, b, a)` colour (alpha ignored), or null if it is neither rgba nor hex. */
export const rgbaToHex = (color: string): string | null => {
	const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
	if (!match) return normalizeHex(color);
	return `#${match
		.slice(1, 4)
		.map((channel) => Number(channel).toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
};

/** A typed hex colour as `#RRGGBB`: six digits, or three ("#0af" is "#00AAFF"); null when it is neither. */
export const normalizeHex = (hex: string): string | null => {
	const value = hex.trim().replace(/^#/, "");
	if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
	if (/^[0-9a-f]{3}$/i.test(value)) {
		return `#${[...value].map((digit) => digit + digit).join("").toUpperCase()}`;
	}
	return null;
};

/** The same hue, darkened in steps until it reads on white (at least 4.6:1). */
export const darkenForWhite = (hex: string): string => {
	const normalized = normalizeHex(hex) ?? "#000000";
	const value = Number.parseInt(normalized.slice(1), 16);
	let channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	for (let step = 0; step < 40; step++) {
		const candidate = `#${channels
			.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
			.join("")
			.toUpperCase()}`;
		if (contrastOnWhite(candidate) >= 4.6) return candidate;
		channels = channels.map((channel) => channel * 0.93);
	}
	return "#333333";
};

export const contrastRatio = (color: string): number => contrastOnWhite(color);
