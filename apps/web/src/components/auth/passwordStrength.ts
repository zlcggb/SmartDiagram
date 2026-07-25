export type PasswordStrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  score: number;
  checks: {
    minLength: boolean;
    hasLower: boolean;
    hasUpper: boolean;
    hasDigit: boolean;
    hasSpecial: boolean;
  };
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const checks = {
    minLength: password.length >= 8,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasDigit: /\d/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password)
  };

  if (!password) {
    return { level: "empty", score: 0, checks };
  }

  const variety = [
    checks.hasLower,
    checks.hasUpper,
    checks.hasDigit,
    checks.hasSpecial
  ].filter(Boolean).length;

  if (!checks.minLength || variety <= 1) {
    return { level: "weak", score: 1, checks };
  }
  if (variety === 2) {
    return { level: "fair", score: 2, checks };
  }
  if (variety === 3) {
    return { level: "good", score: 3, checks };
  }
  return { level: "strong", score: 4, checks };
}

export const passwordStrengthBarColors: Record<Exclude<PasswordStrengthLevel, "empty">, string> = {
  weak: "bg-rose-500",
  fair: "bg-amber-500",
  good: "bg-blue-500",
  strong: "bg-emerald-500"
};
