export type Strength = "weak" | "fair" | "strong";

/** Simple, explainable rating used when choosing the main password. */
export function passwordStrength(password: string): Strength {
	const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
	if (password.length < 8 || (password.length < 10 && classes < 2)) return "weak";
	if (password.length >= 12 && classes >= 3) return "strong";
	return "fair";
}
