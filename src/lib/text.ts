// Authoring helper: a text field can hold several VARIANTS separated by a line
// of dashes ("---"); one is chosen at random when shown. Backward compatible —
// text with no separator is returned as-is. Pure (rng injectable for tests).

const SEPARATOR = /^\s*-{3,}\s*$/; // a line that is only dashes (3+)

/** Split authored text into its variants (trimmed, blanks dropped). */
export function textVariants(text: string | undefined): string[] {
	if (!text) return [];
	const parts: string[] = [];
	let cur: string[] = [];
	for (const line of text.split('\n')) {
		if (SEPARATOR.test(line)) {
			parts.push(cur.join('\n'));
			cur = [];
		} else {
			cur.push(line);
		}
	}
	parts.push(cur.join('\n'));
	return parts.map((p) => p.trim()).filter(Boolean);
}

/** One variant at random (uniform). Empty string when there is no text. */
export function pickTextVariant(text: string | undefined, rng: () => number = Math.random): string {
	const v = textVariants(text);
	if (!v.length) return '';
	return v[Math.min(v.length - 1, Math.floor(rng() * v.length))];
}
