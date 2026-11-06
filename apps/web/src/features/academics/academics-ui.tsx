'use client';

import type { AcademicStatus } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Badge } from '@classloom/ui/components/ui/badge';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@classloom/ui/components/ui/dialog';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { cn } from '@classloom/ui/lib/utils';
import { IconPlus } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { useLastShown } from '../iam/iam-ui';
import { ConfirmDialog } from '../school-settings/years-list';
import { useAcademicsErrorText } from './academics-errors';

/** A stream, house or room as the lists need it. */
export interface AcademicsItem {
  id: string;
  name: string;
  status: AcademicStatus;
}

/** A form's select trigger: full width, 40 px, 44 px on touch. */
export const TRIGGER_CLASS = cn(
  'w-full',
  CONTROL_CLASS,
  'data-[size=default]:h-10 pointer-coarse:data-[size=default]:h-11',
);

/** The namespaces under `academics` whose lists share this layout. */
export type AcademicsListKind = 'streams' | 'houses' | 'rooms' | 'subjects';

/** Active first, then by name. */
export const sortItems = <T extends AcademicsItem>(items: readonly T[]): T[] =>
  [...items].sort(
    (a, b) =>
      Number(a.status === 'ARCHIVED') - Number(b.status === 'ARCHIVED') ||
      a.name.localeCompare(b.name),
  );

const itemHeadingId = (id: string) => `academics-item-${id}`;

/** Focuses the element with `id`; false when it didn't take focus (an open dialog keeps it). */
function focusById(id: string): boolean {
  const element = document.getElementById(id);
  element?.focus();
  return element !== null && document.activeElement === element;
}

/** The tab's heading (focused after a delete), its description and the read-only notice. */
export function TabIntro({
  headingId,
  title,
  description,
  canEdit,
  readOnlyNotice,
}: {
  headingId: string;
  title: string;
  description: string;
  canEdit: boolean;
  /** The read-only notice, when the page's own wording differs from the classes one. */
  readOnlyNotice?: string;
}) {
  const t = useTranslations('academics.common');
  return (
    <div className="flex flex-col gap-2">
      <h2 id={headingId} tabIndex={-1} className="text-h5 break-words outline-none">
        {title}
      </h2>
      <p className="text-muted-foreground">{description}</p>
      {!canEdit ? (
        <Alert className="mt-2">
          <AlertDescription>{readOnlyNotice ?? t('readOnlyNotice')}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** The "Add …" button, disabled with a note once the school is at its limit. */
export function AddButton({
  label,
  onClick,
  limit,
  count,
}: {
  label: string;
  onClick: () => void;
  limit?: number;
  count: number;
}) {
  const t = useTranslations('academics.common');
  const atLimit = limit !== undefined && count >= limit;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button className={BUTTON_CLASS} disabled={atLimit} onClick={onClick}>
        <IconPlus aria-hidden="true" />
        {label}
      </Button>
      {atLimit ? (
        <p className="text-muted-foreground text-sm">{t('limitReached', { limit })}</p>
      ) : null}
    </div>
  );
}

/** The loading line, or the load error with a retry, while a list query has no data. */
export function ListState({ isError, onRetry }: { isError: boolean; onRetry: () => void }) {
  const t = useTranslations('academics.common');
  if (isError) {
    return (
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <AlertDescription>{t('loadError')}</AlertDescription>
        <Button variant="outline" className={BUTTON_CLASS} onClick={onRetry}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2" role="status">
      <Spinner aria-hidden="true" />
      {t('loading')}
    </p>
  );
}

/** A list with nothing in it yet: a title, a line about what to add, and any actions. */
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="bg-card flex flex-col items-start gap-3 rounded-xl border p-5">
      <p className="text-h6">{title}</p>
      <p className="text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

/** The "Archived" pill. */
export function ArchivedBadge() {
  const t = useTranslations('academics.common');
  return (
    <Badge variant="outline" className="border-border text-muted-foreground h-6 px-2.5">
      {t('archived')}
    </Badge>
  );
}

/** A dialog holding an add or edit form. It keeps its wording while it fades out. */
export function FormDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-lg">
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle className="text-h6 break-words">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

interface ItemListProps<T extends AcademicsItem> {
  kind: AcademicsListKind;
  items: readonly T[];
  canEdit: boolean;
  /** The tab heading's id: focus goes there after a delete, as the row is gone. */
  headingId: string;
  /** What the row shows under its name (a colour, a type and capacity). */
  details?: (item: T) => ReactNode;
  /** Badges beside the name. */
  badges?: (item: T) => ReactNode;
  onEdit: (item: T) => void;
  archive: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  /** Refetches the list after a change. */
  onChanged: () => void;
  /**
   * Where focus goes after Archive when the archived row leaves the list (archived ones hidden);
   * by default the row's own heading.
   */
  archiveFocusId?: string;
}

/**
 * A list of streams, houses or rooms, active first: cards from `md`, rows below. With `canEdit`
 * each offers Edit, Archive or Restore, and Delete; Archive and Delete ask first, and a refusal
 * shows its section 7 message.
 */
export function ItemList<T extends AcademicsItem>({
  kind,
  items,
  canEdit,
  headingId,
  details,
  badges,
  onEdit,
  archive,
  restore,
  remove,
  onChanged,
  archiveFocusId,
}: ItemListProps<T>) {
  const t = useTranslations('academics.common');
  const tKind = useTranslations(`academics.${kind}`);
  const errorText = useAcademicsErrorText();
  const [confirming, setConfirming] = useState<{ action: 'archive' | 'delete'; item: T } | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const shown = useLastShown(confirming);
  // After Archive or Restore the row moves and its button changes, so focus goes to the row's
  // heading (WCAG 2.4.3), again once the refetch has re-sorted the list.
  const focusAfterUpdate = useRef<string | null>(null);
  // Where the confirm dialog hands focus when it closes after acting.
  const focusOnClose = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterUpdate.current;
    if (id && focusById(id)) focusAfterUpdate.current = null;
  }, [items]);

  async function runRestore(item: T) {
    setListError(null);
    setPending(true);
    try {
      await restore(item.id);
      focusAfterUpdate.current = itemHeadingId(item.id);
      focusById(itemHeadingId(item.id));
      onChanged();
      toast.add({ title: t('restoredToast', { name: item.name }), type: 'success' });
    } catch (error) {
      setListError(errorText(error));
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!confirming) return;
    const { action, item } = confirming;
    setPending(true);
    try {
      if (action === 'archive') {
        await archive(item.id);
        const target = archiveFocusId ?? itemHeadingId(item.id);
        focusAfterUpdate.current = target;
        focusOnClose.current = target;
      } else {
        await remove(item.id);
        focusOnClose.current = headingId;
      }
      onChanged();
      toast.add({
        title: t(action === 'archive' ? 'archivedToast' : 'deletedToast', { name: item.name }),
        type: 'success',
      });
      setConfirming(null);
    } catch (error) {
      setConfirmError(errorText(error));
    } finally {
      setPending(false);
    }
  }

  const open = (action: 'archive' | 'delete', item: T) => {
    setConfirmError(null);
    setConfirming({ action, item });
  };

  return (
    <>
      {listError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{listError}</AlertDescription>
        </Alert>
      ) : null}
      {/* One list: rows divided by rules on small screens, a grid of cards from `md`. The list
          stays mounted while empty, so its confirm dialog survives the last delete. */}
      {items.length > 0 ? (
        <ul className="bg-card divide-y rounded-xl border md:grid md:grid-cols-2 md:gap-4 md:divide-y-0 md:border-0 md:bg-transparent xl:grid-cols-3">
          {sortItems(items).map((item) => (
            <li
              key={item.id}
              className="md:bg-card flex min-w-0 flex-col gap-3 p-4 md:rounded-xl md:border md:p-5 md:shadow-xs"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h3
                  id={itemHeadingId(item.id)}
                  tabIndex={-1}
                  className={cn(
                    'text-h6 min-w-0 break-words outline-none',
                    item.status === 'ARCHIVED' && 'text-muted-foreground',
                  )}
                >
                  {item.name}
                </h3>
                {badges?.(item)}
                {item.status === 'ARCHIVED' ? <ArchivedBadge /> : null}
              </div>
              {details?.(item)}
              {canEdit ? (
                <div className="flex flex-wrap gap-2 md:mt-auto">
                  <Button
                    variant="outline"
                    className={BUTTON_CLASS}
                    aria-label={t('editLabel', { name: item.name })}
                    onClick={() => onEdit(item)}
                  >
                    {t('edit')}
                  </Button>
                  {item.status === 'ACTIVE' ? (
                    <Button
                      variant="outline"
                      className={BUTTON_CLASS}
                      disabled={pending}
                      aria-label={t('archiveLabel', { name: item.name })}
                      onClick={() => open('archive', item)}
                    >
                      {t('archive')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className={BUTTON_CLASS}
                      disabled={pending}
                      aria-label={t('restoreLabel', { name: item.name })}
                      onClick={() => void runRestore(item)}
                    >
                      {t('restore')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className={cn(BUTTON_CLASS, 'text-danger-strong')}
                    disabled={pending}
                    aria-label={t('deleteLabel', { name: item.name })}
                    onClick={() => open('delete', item)}
                  >
                    {t('delete')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        title={t(shown?.action === 'delete' ? 'deleteTitle' : 'archiveTitle', {
          name: shown?.item.name ?? '',
        })}
        body={<p>{tKind(shown?.action === 'delete' ? 'deleteBody' : 'archiveBody')}</p>}
        action={t(shown?.action === 'delete' ? 'delete' : 'archive')}
        pendingLabel={t(shown?.action === 'delete' ? 'deleting' : 'archiving')}
        cancelLabel={t('cancel')}
        destructive={shown?.action === 'delete'}
        pending={pending}
        errorText={confirmError}
        // After acting, the button that opened the dialog is gone or has changed: focus goes to
        // the row's heading (archive) or the tab's heading (delete). Cancelled, back to the button.
        finalFocus={() => {
          const id = focusOnClose.current;
          focusOnClose.current = null;
          return (id && document.getElementById(id)) || true;
        }}
        onConfirm={() => void confirm()}
        onClose={() => setConfirming(null)}
      />
    </>
  );
}
