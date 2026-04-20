/**
 * Rank-based hue assignment for "color by" column.
 *
 * Given a set of rows and a column key, returns a map from the stringified
 * value → hue (0–270°). Unique values are sorted (numerically if every
 * non-missing value parses as a finite number; alphabetically otherwise) and
 * the resulting ranks are spread across the hue wheel. We stop at 270° rather
 * than wrapping to 360° so the lowest and highest values are visually
 * distinguishable at a glance.
 *
 * Use with {@link hueToTableFill} / {@link hueToMapPin} for consistent
 * rendering across DataTable cells and Leaflet circleMarkers.
 */
export function makeRankedHueMap(
	rows: Array<Record<string, unknown>>,
	key: string
): Map<string, number> {
	const values = rows
		.map((r) => r[key])
		.filter((v) => v != null && v !== '')
		.map((v) => String(v));
	if (values.length === 0) return new Map();

	const unique = Array.from(new Set(values));
	const nums = unique.map((v) => Number(v));
	const numeric = unique.length > 0 && nums.every((n) => Number.isFinite(n));
	const sorted = numeric
		? unique.slice().sort((a, b) => Number(a) - Number(b))
		: unique.slice().sort((a, b) => a.localeCompare(b));

	const rank = new Map<string, number>();
	const total = sorted.length;
	sorted.forEach((v, i) => {
		const hue = total <= 1 ? 0 : Math.round((i / (total - 1)) * 270);
		rank.set(v, hue);
	});
	return rank;
}

/** Low-saturation dark-theme tint for DataTable row cells. */
export function hueToTableFill(hue: number): string {
	return `background-color: hsl(${hue}, 30%, 22%);`;
}

/** Saturated hue for Leaflet circleMarker fills — reads against tiles. */
export function hueToMapPin(hue: number): string {
	return `hsl(${hue}, 65%, 55%)`;
}

/** Deterministic hash fallback when a value isn't in the rank map (shouldn't
 *  happen when we compute rank over the same rows we render, but harmless). */
export function hashHue(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h) % 360;
}
