'use client';

import { getListInvitationsQueryKey, useCreateInvitation } from '@classloom/api-client';
import { createInvitationRequestSchema, type Role } from '@classloom/contracts';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button } from '@classloom/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@classloom/ui/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { toast } from '@classloom/ui/components/ui/toast';
import { IconUserPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';

import { BUTTON_CLASS, CONTROL_CLASS } from '../auth/auth-ui';
import { fieldErrorPaths, iamErrorOf } from './iam-errors';
import { RoleChecklist, useIamErrorText } from './iam-ui';

const NOT_CACHED = { mutation: { gcTime: 0 } } as const;

type FieldName = 'email' | 'name' | 'roles';

interface InviteDialogProps {
  /** The roles the viewer may give. */
  roles: readonly Role[] | undefined;
  rolesFailed: boolean;
  onReauth: () => void;
}

/** "Invite people": email, name and roles; the person gets an email with a link to join. */
export function InviteDialog({ roles, rolesFailed, onReauth }: InviteDialogProps) {
  const t = useTranslations('iam.invite');
  const tMembers = useTranslations('iam.members');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className={BUTTON_CLASS} />}>
        <IconUserPlus aria-hidden="true" />
        {tMembers('invite')}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
        <InviteForm
          roles={roles}
          rolesFailed={rolesFailed}
          onReauth={onReauth}
          title={t('title')}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  roles,
  rolesFailed,
  onReauth,
  title,
  onClose,
}: InviteDialogProps & { title: string; onClose: () => void }) {
  const t = useTranslations('iam.invite');
  const tMembers = useTranslations('iam.members');
  const errorText = useIamErrorText();
  const queryClient = useQueryClient();
  const create = useCreateInvitation(NOT_CACHED);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const submitting = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = createInvitationRequestSchema.safeParse({
      email: email.trim(),
      name,
      roleIds: [...selected],
    });
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === 'roleIds' ? 'roles' : issue.path[0];
        if (field === 'email' || field === 'name' || field === 'roles')
          next[field] ??= t(`errors.${field}`);
      }
      setErrors(next);
      setFormError(null);
      return;
    }
    submitting.current = true;
    setErrors({});
    setFormError(null);
    try {
      await create.mutateAsync({ data: parsed.data });
      toast.add({ title: t('sent', { email: parsed.data.email }), type: 'success' });
      void queryClient.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
      onClose();
    } catch (failure) {
      const outcome = iamErrorOf(failure);
      if (outcome === 'recentSignIn') onReauth();
      const paths = fieldErrorPaths(failure);
      if (outcome === 'alreadyMember' || outcome === 'alreadyInvited') {
        setErrors({ email: errorText(outcome) });
        emailRef.current?.focus();
      } else if (paths.length > 0) {
        const next: Partial<Record<FieldName, string>> = {};
        for (const path of paths) {
          const field = path === 'roleIds' ? 'roles' : path;
          if (field === 'email' || field === 'name' || field === 'roles')
            next[field] = t(`errors.${field}`);
        }
        if (Object.keys(next).length > 0) setErrors(next);
        else setFormError(errorText('generic'));
      } else {
        setFormError(errorText(outcome));
      }
    } finally {
      submitting.current = false;
    }
  }

  const pending = create.isPending;

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 pr-8">
        <DialogTitle className="text-h6">{title}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </div>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="invite-email">{t('email')}</FieldLabel>
          <Input
            ref={emailRef}
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            className={CONTROL_CLASS}
            value={email}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'invite-email-error' : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError id="invite-email-error">{errors.email}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="invite-name">{t('name')}</FieldLabel>
          <Input
            id="invite-name"
            autoComplete="off"
            className={CONTROL_CLASS}
            value={name}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'invite-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError id="invite-name-error">{errors.name}</FieldError>
        </Field>
        {rolesFailed ? (
          <Alert variant="destructive">
            <AlertDescription>{t('rolesLoadFailed')}</AlertDescription>
          </Alert>
        ) : !roles ? (
          <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner aria-hidden="true" />
            {tMembers('loading')}
          </p>
        ) : roles.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noRoles')}</p>
        ) : (
          <RoleChecklist
            legend={t('roles')}
            hint={t('rolesHint')}
            roles={roles}
            selected={selected}
            error={errors.roles}
            disabled={pending}
            onToggle={(id, checked) =>
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
        )}
      </FieldGroup>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{formError}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className={BUTTON_CLASS} onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" className={BUTTON_CLASS} disabled={pending}>
          {pending ? <Spinner aria-hidden="true" /> : null}
          {pending ? t('submitting') : t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
