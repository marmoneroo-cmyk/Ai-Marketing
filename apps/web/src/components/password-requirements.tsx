import { PASSWORD_RULES } from "@brandpilot/core";
import { cn } from "@/lib/cn";

interface PasswordRequirementsProps {
  password: string;
}

/**
 * Live checklist for the shared password-strength policy (`PASSWORD_RULES`
 * from `@brandpilot/core`). Rendered under every NEW-password field —
 * signup, reset-password, accept-invite — so what the user sees can never
 * drift from what the API's `passwordSchema` actually enforces. Login is
 * exempt: it authenticates against an existing stored hash, so this
 * component is never shown there.
 */
export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  return (
    <ul aria-label="Password requirements" className="mt-2 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-1.5 text-xs",
              met ? "text-emerald-600 dark:text-emerald-400" : "text-subtle",
            )}
          >
            <span aria-hidden="true">{met ? "✓" : "○"}</span>
            <span>{rule.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
