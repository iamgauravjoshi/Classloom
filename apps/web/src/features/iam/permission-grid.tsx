'use client';

import { Button } from '@classloom/ui/components/ui/button';
import { Checkbox } from '@classloom/ui/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@classloom/ui/components/ui/tooltip';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';

import {
  actionColumns,
  type CatalogueModule,
  gridState,
  PRESET_KEYS,
  type PresetKey,
} from './grid-helpers';

/** A 44 px target around the 16 px box, on every screen: the cells are as tall as the target. */
const BOX_CLASS = 'after:-inset-3.5';

interface BoxProps {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  /** The viewer cannot grant it: focusable and ticked as it is, but it does not change. */
  locked: boolean;
  /** Nothing in the grid changes (Owner, or no `iam.manage`). */
  readOnly: boolean;
  noteId: string;
  onChange: (checked: boolean) => void;
}

/**
 * One checkbox. A permission the viewer can't grant stays focusable (`aria-disabled`, not
 * `disabled`) so that keyboard and screen-reader users reach the reason too: a tooltip on focus
 * and hover, and the same words as its description.
 */
function GridBox({ label, checked, indeterminate, locked, readOnly, noteId, onChange }: BoxProps) {
  const t = useTranslations('iam.grid');
  if (readOnly) {
    // Not `disabled`: keyboard users can still reach each box and read its state.
    return (
      <Checkbox
        className={cn(BOX_CLASS, 'cursor-not-allowed opacity-50')}
        aria-label={label}
        aria-disabled="true"
        checked={checked}
        indeterminate={indeterminate}
        readOnly
      />
    );
  }
  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Checkbox
              className={cn(BOX_CLASS, 'cursor-not-allowed opacity-50')}
              aria-label={label}
              aria-disabled="true"
              aria-describedby={noteId}
              checked={checked}
              indeterminate={indeterminate}
              readOnly
            />
          }
        />
        <TooltipContent>{t('cantGrant')}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Checkbox
      className={BOX_CLASS}
      aria-label={label}
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(next) => onChange(next)}
    />
  );
}

export interface PermissionGridProps {
  catalogue: readonly CatalogueModule[];
  selected: ReadonlySet<string>;
  grantable: ReadonlySet<string>;
  readOnly: boolean;
  onToggleKey: (key: string, checked: boolean) => void;
  onToggleModule: (module: string, checked: boolean) => void;
}

/**
 * The permission grid: from `md` a table of checkboxes (a row header per module, a column header
 * per action, an empty cell where the module has no such action), below that one card per module
 * with its actions as a checkbox list. Both draw the same state and the same checkbox names, and
 * only one shows.
 */
export function PermissionGrid({
  catalogue,
  selected,
  grantable,
  readOnly,
  onToggleKey,
  onToggleModule,
}: PermissionGridProps) {
  const t = useTranslations();
  const noteId = useId();
  const modules = useMemo(
    () => gridState(catalogue, selected, grantable),
    [catalogue, selected, grantable],
  );
  const columns = useMemo(() => actionColumns(catalogue), [catalogue]);
  const moduleLabel = (labelKey: string) => t(labelKey);
  const actionLabel = (action: string) => t(`iam.permissions.actions.${action}`);

  return (
    <>
      {/* The reason a cell can't be changed, as a description for the cells that point at it. */}
      <span id={noteId} className="sr-only">
        {t('iam.grid.cantGrant')}
      </span>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('iam.grid.caption')}</caption>
          <thead className="text-muted-foreground border-border border-b">
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('iam.grid.module')}
              </th>
              {columns.map((action) => (
                <th key={action} scope="col" className="px-2 py-2 text-center font-medium">
                  {actionLabel(action)}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t('iam.grid.selectAll')}
              </th>
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => {
              const label = moduleLabel(mod.labelKey);
              const lockedAll = mod.actions.every((action) => action.disabled);
              return (
                <tr key={mod.module} className="border-border border-b last:border-b-0">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {label}
                    <span className="text-muted-foreground block text-xs font-normal">
                      {t('iam.grid.count', { checked: mod.enabledCount, total: mod.total })}
                    </span>
                  </th>
                  {columns.map((action) => {
                    const cell = mod.actions.find(
                      (candidate) => candidate.key === `${mod.module}.${action}`,
                    );
                    return (
                      <td key={action} className="px-2 py-1 text-center">
                        {cell ? (
                          <span className="inline-flex h-11 w-11 items-center justify-center">
                            <GridBox
                              label={t('iam.grid.actionFor', {
                                module: label,
                                action: actionLabel(action),
                              })}
                              checked={cell.checked}
                              locked={cell.disabled}
                              readOnly={readOnly}
                              noteId={noteId}
                              onChange={(next) => onToggleKey(cell.key, next)}
                            />
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-center">
                    <span className="inline-flex h-11 w-11 items-center justify-center">
                      <GridBox
                        label={t('iam.grid.selectAllFor', { module: label })}
                        checked={mod.enabledCount === mod.total}
                        indeterminate={mod.enabledCount > 0 && mod.enabledCount < mod.total}
                        locked={lockedAll}
                        readOnly={readOnly}
                        noteId={noteId}
                        onChange={(next) => onToggleModule(mod.module, next)}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {modules.map((mod) => {
          const label = moduleLabel(mod.labelKey);
          const lockedAll = mod.actions.every((action) => action.disabled);
          return (
            <li key={mod.module}>
              <fieldset className="border-border flex min-w-0 flex-col gap-1 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{label}</legend>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="text-muted-foreground text-xs">
                    {t('iam.grid.count', { checked: mod.enabledCount, total: mod.total })}
                  </span>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <span>{t('iam.grid.selectAll')}</span>
                    <GridBox
                      label={t('iam.grid.selectAllFor', { module: label })}
                      checked={mod.enabledCount === mod.total}
                      indeterminate={mod.enabledCount > 0 && mod.enabledCount < mod.total}
                      locked={lockedAll}
                      readOnly={readOnly}
                      noteId={noteId}
                      onChange={(next) => onToggleModule(mod.module, next)}
                    />
                  </label>
                </div>
                <ul className="flex flex-col">
                  {mod.actions.map((cell) => {
                    const action = cell.key.slice(cell.key.indexOf('.') + 1);
                    return (
                      <li key={cell.key}>
                        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
                          <span>{actionLabel(action)}</span>
                          <GridBox
                            label={t('iam.grid.actionFor', {
                              module: label,
                              action: actionLabel(action),
                            })}
                            checked={cell.checked}
                            locked={cell.disabled}
                            readOnly={readOnly}
                            noteId={noteId}
                            onChange={(next) => onToggleKey(cell.key, next)}
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </li>
          );
        })}
      </ul>
    </>
  );
}

interface PresetBarProps {
  disabled: boolean;
  onPreset: (preset: PresetKey) => void;
}

/** Read only, Editor, Manager, Full access: each replaces the ticks within what the viewer can grant. */
export function PresetBar({ disabled, onPreset }: PresetBarProps) {
  const t = useTranslations('iam.grid');
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm font-medium">
        {t('presets')}
        <span className="text-muted-foreground block text-xs font-normal">{t('presetsHint')}</span>
      </p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {PRESET_KEYS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant="outline"
            className="h-10 px-4 pointer-coarse:h-11"
            disabled={disabled}
            onClick={() => onPreset(preset)}
          >
            {t(`preset.${preset}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
