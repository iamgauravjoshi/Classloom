'use client';

import { useEnableTwoFactor, useStartTwoFactorSetup } from '@classloom/api-client';
import type { TwoFactorSetup } from '@classloom/contracts';
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
import { FieldGroup } from '@classloom/ui/components/ui/field';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { IconCopy } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { toDataURL } from 'qrcode';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { BUTTON_CLASS } from '../auth/auth-ui';
import { CODE_LENGTH, CodeField } from './code-field';
import { groupKey } from './format';
import { RecoveryCodesPanel } from './recovery-codes-panel';
import { securityErrorOf, setupFailureAction } from './security-errors';
import { useCopy, useErrorText } from './security-ui';

// The secret and the recovery codes live in this dialog only: never kept in the mutation cache.
const NOT_CACHED = { mutation: { gcTime: 0 } } as const;

/** `qr` when the code could not be drawn: the key below still works. */
const QR_FAILED = 'failed';

interface TwoFactorSetupDialogProps {
  email: string;
  /** A 403 asked for a recent sign-in: the page sends the person to sign in again. */
  onReauth: () => void;
  /** Two-step is on and the codes were saved (Done). */
  onEnabled: () => void;
  /** A 409: two-step was already on (turned on elsewhere). The dialog has closed. */
  onAlreadyOn: () => void;
}

/** "Turn on" and its three-step dialog: scan the QR code, enter a code, save the recovery codes. */
export function TwoFactorSetupDialog({
  email,
  onReauth,
  onEnabled,
  onAlreadyOn,
}: TwoFactorSetupDialogProps) {
  const t = useTranslations('account.security');
  const [open, setOpen] = useState(false);
  // While the recovery codes show, the dialog only closes through Done.
  const [locked, setLocked] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button className={BUTTON_CLASS} />}>
        {t('twoFactor.turnOn')}
      </DialogTrigger>
      <DialogContent showCloseButton={!locked} className="gap-5 sm:max-w-md">
        <SetupFlow
          email={email}
          onReauth={onReauth}
          onLock={() => setLocked(true)}
          onCancel={() => setOpen(false)}
          onAlreadyOn={() => {
            setLocked(false);
            setOpen(false);
            onAlreadyOn();
          }}
          onDone={() => {
            setLocked(false);
            setOpen(false);
            onEnabled();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

type Step =
  | { name: 'starting' }
  | { name: 'scan' | 'code'; setup: TwoFactorSetup }
  | { name: 'codes'; codes: string[]; createdAt: Date };

interface SetupFlowProps {
  email: string;
  onReauth: () => void;
  onLock: () => void;
  onCancel: () => void;
  onAlreadyOn: () => void;
  onDone: () => void;
}

/** Mounted while the dialog is open, so its state (the secret, the codes) goes when it closes. */
function SetupFlow({ email, onReauth, onLock, onCancel, onAlreadyOn, onDone }: SetupFlowProps) {
  const t = useTranslations('account.security');
  const errorText = useErrorText();
  const copy = useCopy();
  const start = useStartTwoFactorSetup(NOT_CACHED);
  const enable = useEnableTwoFactor(NOT_CACHED);
  const [step, setStep] = useState<Step>({ name: 'starting' });
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const started = useRef(false);
  const submitting = useRef(false);

  const begin = useCallback(
    async (expiredNotice: string | null) => {
      setFailure(null);
      setStep({ name: 'starting' });
      try {
        const setup = await start.mutateAsync();
        setNotice(expiredNotice);
        setStep({ name: 'scan', setup });
      } catch (error) {
        const outcome = securityErrorOf(error);
        switch (setupFailureAction(outcome)) {
          case 'reauth':
            setRedirecting(true);
            onReauth();
            break;
          case 'alreadyOn':
            onAlreadyOn();
            break;
          default:
            setFailure(errorText(outcome));
        }
      }
    },
    [start, errorText, onReauth, onAlreadyOn],
  );

  // One setup per opening (React's development double effect must not start a second one).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin(null);
  }, [begin]);

  const otpauthUrl = step.name === 'scan' || step.name === 'code' ? step.setup.otpauthUrl : null;
  useEffect(() => {
    if (!otpauthUrl) return;
    let live = true;
    toDataURL(otpauthUrl, { margin: 1, width: 192, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (live) setQr(url);
      })
      .catch(() => {
        if (live) setQr(QR_FAILED);
      });
    return () => {
      live = false;
    };
  }, [otpauthUrl]);

  async function submit(candidate: string) {
    if (submitting.current || step.name !== 'code') return;
    const entered = candidate.replace(/\s/g, '');
    if (entered.length !== CODE_LENGTH) {
      setCodeError(t('errors.codeRequired'));
      return;
    }
    submitting.current = true;
    setCodeError(null);
    try {
      const { recoveryCodes } = await enable.mutateAsync({ data: { code: entered } });
      enable.reset();
      onLock();
      setStep({ name: 'codes', codes: recoveryCodes, createdAt: new Date() });
    } catch (error) {
      const outcome = securityErrorOf(error);
      setCode('');
      switch (setupFailureAction(outcome)) {
        case 'reauth':
          setRedirecting(true);
          onReauth();
          break;
        case 'restart':
          setQr(null);
          await begin(t('setup.expired'));
          break;
        case 'alreadyOn':
          onAlreadyOn();
          break;
        case 'show':
          setCodeError(errorText(outcome));
      }
    } finally {
      submitting.current = false;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(code);
  }

  if (step.name === 'codes') {
    return (
      <RecoveryCodesPanel
        codes={step.codes}
        email={email}
        createdAt={step.createdAt}
        eyebrow={t('setup.step', { step: 3 })}
        onDone={onDone}
      />
    );
  }

  const header = (stepNumber: number, description?: string) => (
    <div className="flex flex-col gap-2 pr-8">
      <p className="text-muted-foreground text-xs">{t('setup.step', { step: stepNumber })}</p>
      <DialogTitle className="text-h6">{t('setup.title')}</DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
    </div>
  );

  if (step.name === 'starting') {
    return (
      <>
        {header(1)}
        {redirecting ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t('redirecting')}
          </p>
        ) : failure ? (
          <Alert variant="destructive" className="flex flex-col items-start gap-3">
            <AlertDescription>{failure}</AlertDescription>
            <Button variant="outline" className={BUTTON_CLASS} onClick={() => void begin(null)}>
              {t('retry')}
            </Button>
          </Alert>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
            <Spinner aria-hidden="true" />
            {t('setup.starting')}
          </p>
        )}
      </>
    );
  }

  if (step.name === 'scan') {
    const key = groupKey(step.setup.secret);
    return (
      <>
        {header(1, t('setup.scan'))}
        {notice ? (
          <Alert>
            <AlertDescription role="status">{notice}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex justify-center">
          {qr === QR_FAILED ? (
            <p role="alert" className="text-danger-strong text-sm">
              {t('setup.qrFailed')}
            </p>
          ) : qr ? (
            // A data URL drawn here: next/image has nothing to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt={t('setup.qrAlt')}
              width={192}
              height={192}
              className="rounded-lg bg-white p-2"
            />
          ) : (
            <div className="bg-muted size-48 rounded-lg" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          {/* The visible sentence right before the key is its label. */}
          <p className="text-sm">{t('setup.cantScan')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-muted rounded-md px-2 py-1 font-mono text-sm break-all">{key}</code>
            <Button
              variant="outline"
              className={BUTTON_CLASS}
              onClick={() => void copy(step.setup.secret, t('setup.keyCopied'))}
            >
              <IconCopy aria-hidden="true" />
              {t('setup.copyKey')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className={BUTTON_CLASS} onClick={onCancel}>
            {t('setup.cancel')}
          </Button>
          <Button
            className={BUTTON_CLASS}
            onClick={() => {
              setNotice(null);
              setStep({ name: 'code', setup: step.setup });
            }}
          >
            {t('setup.next')}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {header(2, t('setup.enterCode'))}
      <FieldGroup>
        <CodeField
          id="setup-code"
          label={t('setup.codeLabel')}
          value={code}
          error={codeError}
          onChange={(next) => {
            setCode(next);
            if (codeError) setCodeError(null);
          }}
          onComplete={(complete) => void submit(complete)}
        />
      </FieldGroup>
      {redirecting ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t('redirecting')}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className={BUTTON_CLASS}
          onClick={() => {
            setCode('');
            setCodeError(null);
            setStep({ name: 'scan', setup: step.setup });
          }}
        >
          {t('setup.back')}
        </Button>
        <Button type="submit" className={BUTTON_CLASS} disabled={enable.isPending || redirecting}>
          {enable.isPending ? <Spinner aria-hidden="true" /> : null}
          {enable.isPending ? t('setup.verifying') : t('setup.verify')}
        </Button>
      </DialogFooter>
    </form>
  );
}
