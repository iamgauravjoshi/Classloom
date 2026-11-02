'use client';

import { useListRoles } from '@classloom/api-client';
import { type Role, rolesResponseSchema } from '@classloom/contracts';
import { Checkbox } from '@classloom/ui/components/ui/checkbox';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState } from 'react';

import type { IamError } from './iam-errors';

/** `GET /iam/roles`, read through the contract (the generated type shows `key` loosely). */
export function useRoles() {
  return useListRoles({
    query: { select: (data): Role[] => rolesResponseSchema.parse(data).roles },
  });
}

/**
 * The value while it is set, and the last one set after: a dialog keeps its content while it
 * fades out, once the row it was opened for has been cleared.
 */
export function useLastShown<T>(value: T | null): T | null {
  const [shown, setShown] = useState(value);
  if (value !== null && value !== shown) setShown(value);
  return value ?? shown;
}

/** The sentence for a refused Members action. */
export function useIamErrorText() {
  const t = useTranslations('iam.errors');
  return useCallback((error: IamError): string => t(error), [t]);
}

interface RoleChecklistProps {
  legend: string;
  hint?: string;
  roles: readonly Role[];
  selected: ReadonlySet<string>;
  /** Roles shown ticked and fixed: held already, and not the viewer's to change. */
  locked?: ReadonlySet<string>;
  lockedNote?: string;
  error?: string | null;
  disabled?: boolean;
  onToggle: (roleId: string, checked: boolean) => void;
}

/** A role multi-select: one checkbox row per role, a 44 px target on touch. */
export function RoleChecklist({
  legend,
  hint,
  roles,
  selected,
  locked,
  lockedNote,
  error,
  disabled,
  onToggle,
}: RoleChecklistProps) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2"
      aria-describedby={cn(hint && hintId, error && errorId) || undefined}
    >
      <legend className="text-sm font-medium">{legend}</legend>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto p-1">
        {roles.map((role) => {
          const fixed = locked?.has(role.id) ?? false;
          const labelId = `${baseId}-${role.id}`;
          return (
            <li key={role.id}>
              <label
                className={cn(
                  'border-border hover:bg-muted/50 has-focus-visible:ring-ring/50 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 has-focus-visible:ring-3',
                  (disabled || fixed) && 'cursor-not-allowed opacity-70',
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(role.id) || fixed}
                  disabled={disabled || fixed}
                  aria-labelledby={labelId}
                  onCheckedChange={(checked) => onToggle(role.id, checked)}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span id={labelId} className="text-sm font-medium">
                    {role.name}
                  </span>
                  {fixed && lockedNote ? (
                    <span className="text-muted-foreground text-xs">{lockedNote}</span>
                  ) : role.description ? (
                    <span className="text-muted-foreground text-xs">{role.description}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p id={errorId} role="alert" className="text-danger-strong text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
