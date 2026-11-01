import { cn } from '@classloom/ui/lib/utils';
import { IconCircle, IconCircleCheckFilled } from '@tabler/icons-react';

export interface PasswordRule {
  label: string;
  met: boolean;
}

export interface PasswordRulesProps {
  rules: PasswordRule[];
  /** Screen-reader text for a met rule, e.g. "met". */
  metLabel: string;
  /** Screen-reader text for a rule not yet met, e.g. "not met". */
  unmetLabel: string;
  className?: string;
}

/** Live checklist of password rules; state is icon, colour and text, never colour alone. */
export function PasswordRules({ rules, metLabel, unmetLabel, className }: PasswordRulesProps) {
  return (
    <ul role="list" className={cn('flex flex-col gap-1.5 text-sm', className)}>
      {rules.map((rule) => (
        <li
          key={rule.label}
          data-met={rule.met}
          className={cn(
            'flex items-center gap-2',
            rule.met ? 'text-success-strong' : 'text-muted-foreground',
          )}
        >
          {rule.met ? (
            <IconCircleCheckFilled size={16} className="shrink-0" aria-hidden="true" />
          ) : (
            <IconCircle size={16} className="shrink-0" aria-hidden="true" />
          )}
          <span>{rule.label}</span>
          <span className="sr-only">{rule.met ? metLabel : unmetLabel}</span>
        </li>
      ))}
    </ul>
  );
}
