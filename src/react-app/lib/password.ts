// Generated passwords avoid look-alike characters (0/O, 1/l/I) so they can be
// read aloud or copied by hand, and use only symbols every site accepts.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*?";

function randomIndex(max: number): number {
	const limit = Math.floor(0x1_0000_0000 / max) * max; // avoid modulo bias
	const buf = new Uint32Array(1);
	do crypto.getRandomValues(buf);
	while (buf[0] >= limit);
	return buf[0] % max;
}

const pick = (chars: string) => chars[randomIndex(chars.length)];

export function generatePassword(length = 14): string {
	const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
	const all = LOWER + UPPER + DIGITS + SYMBOLS;
	while (chars.length < length) chars.push(pick(all));
	for (let i = chars.length - 1; i > 0; i -= 1) {
		const j = randomIndex(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join("");
}

export type Strength = "weak" | "fair" | "strong";

/** Simple, explainable rating used when choosing the main password. */
export function passwordStrength(password: string): Strength {
	const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
	if (password.length < 8 || (password.length < 10 && classes < 2)) return "weak";
	if (password.length >= 12 && classes >= 3) return "strong";
	return "fair";
}
