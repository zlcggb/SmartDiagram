import { useMemo, useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useT } from "@/app/i18n";
import {
  evaluatePasswordStrength,
  passwordStrengthBarColors,
  type PasswordStrengthLevel
} from "./passwordStrength";

interface AuthPasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  showStrength?: boolean;
  matchValue?: string;
}

const strengthLabelKeys: Record<Exclude<PasswordStrengthLevel, "empty">, string> = {
  weak: "auth.passwordStrengthWeak",
  fair: "auth.passwordStrengthFair",
  good: "auth.passwordStrengthGood",
  strong: "auth.passwordStrengthStrong"
};

export function AuthPasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  showStrength = false,
  matchValue
}: AuthPasswordFieldProps) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const strength = useMemo(
    () => (showStrength ? evaluatePasswordStrength(value) : null),
    [showStrength, value]
  );

  const inputClass =
    "h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-10 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

  const showMatchHint = matchValue !== undefined && matchValue.length > 0;
  const passwordsMatch = showMatchHint && value === matchValue;
  const passwordsMismatch = showMatchHint && value.length > 0 && value !== matchValue;

  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
      <div className="relative">
        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className={inputClass}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {showStrength && strength && strength.level !== "empty" ? (
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1">
            {[1, 2, 3, 4].map((segment) => {
              const active = strength.score >= segment;
              const color = active ? passwordStrengthBarColors[strength.level] : "bg-slate-200";
              return <span key={segment} className={`h-1.5 flex-1 rounded-full ${color}`} />;
            })}
          </div>
          <span className="shrink-0 text-xs font-medium text-slate-600">
            {t(strengthLabelKeys[strength.level])}
          </span>
        </div>
      ) : null}

      {showStrength && !value ? (
        <p className="mt-1 text-xs text-slate-400">{t("auth.passwordHint")}</p>
      ) : null}

      {passwordsMatch ? (
        <p className="mt-1 text-xs font-medium text-emerald-600">{t("auth.passwordMatch")}</p>
      ) : null}
      {passwordsMismatch ? (
        <p className="mt-1 text-xs font-medium text-rose-600">{t("auth.passwordMismatch")}</p>
      ) : null}
    </label>
  );
}
