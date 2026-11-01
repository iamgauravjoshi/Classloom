'use client';

import { getPublicSchool, type PublicSchoolDto, requestSignInCode } from '@classloom/api-client';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { validateSchoolCode } from '@classloom/utils';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { codeRequestErrorKey, type EmailErrorKey, schoolLookupErrorKey } from './auth-errors';
import { AuthLogo } from './auth-ui';
import { CodeStep } from './code-step';
import { CredentialsStep } from './credentials-step';
import { SchoolStep, type SchoolStepError } from './school-step';
import { loadSentCode, reusableCode, saveSentCode, type SentCode, sentCode } from './sent-code';
import { useRememberedSchool } from './use-remembered-school';

const noSubscription = () => () => {};

type Phase =
  | { step: 'loading' }
  | { step: 'school'; error?: SchoolStepError }
  | { step: 'credentials'; school: PublicSchoolDto; error?: EmailErrorKey }
  | { step: 'code'; school: PublicSchoolDto; code: SentCode };

/** Looks a code up; a code that can't exist is "not found" without asking the API. */
async function findSchool(
  raw: string,
): Promise<{ school: PublicSchoolDto } | { error: SchoolStepError }> {
  const check = validateSchoolCode(raw);
  if (!check.ok) return { error: 'notFound' };
  try {
    return { school: await getPublicSchool(encodeURIComponent(check.code)) };
  } catch (error) {
    return { error: schoolLookupErrorKey(error) };
  }
}

/**
 * Re-confirming who you are: the school from the session, then one emailed code, then step 3. If
 * the code can't go out, step 2 opens (email filled in) where it can be asked for again.
 */
async function reauthPhase({
  schoolCode,
  email,
}: {
  schoolCode: string;
  email: string;
}): Promise<Phase> {
  const found = await findSchool(schoolCode);
  if (!('school' in found)) return { step: 'school', error: found.error };
  const { school } = found;
  // A reload within 60 seconds shows the code already sent: the API would drop a second one.
  const earlier = reusableCode(loadSentCode(), school.code, email);
  try {
    const code =
      earlier ??
      sentCode(
        school.code,
        email,
        (await requestSignInCode({ schoolCode: school.code, email })).maskedEmail,
      );
    saveSentCode(code);
    return { step: 'code', school, code };
  } catch (error) {
    return { step: 'credentials', school, error: codeRequestErrorKey(error) };
  }
}

interface SignInFlowProps {
  /** `?school=` from the address, if any; else the code remembered on this device is used. */
  initialSchool: string | null;
  /** Where to go after signing in, already checked by `safeNextPath`. */
  nextPath: string;
  /**
   * Set (from the signed-in session, by the page) for `?reauth=1`: open on the code step for this
   * school and email, with the code sent once, so a sensitive change can be confirmed.
   */
  reauth?: { schoolCode: string; email: string; remember: boolean } | null;
}

/** Sign-in in three steps: school code, then email or mobile and password, then (optionally) a code. */
export function SignInFlow({ initialSchool, nextPath, reauth = null }: SignInFlowProps) {
  const t = useTranslations('auth');
  const { code: rememberedCode, remember } = useRememberedSchool();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  // null until the first step is known (a code to look up, or none).
  const [phase, setPhase] = useState<Phase | null>(null);
  const [schoolCode, setSchoolCode] = useState(reauth?.schoolCode ?? initialSchool ?? '');
  const [identifier, setIdentifier] = useState(reauth?.email ?? '');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(reauth?.remember ?? true);
  const [pending, setPending] = useState(false);
  // Focus moves to the new step only after the person acted, never on first load.
  const [moved, setMoved] = useState(false);
  // The code emailed last: asking again within 60 seconds shows it rather than a fresh 10:00.
  const [lastCode, setLastCode] = useState<SentCode | null>(null);
  const started = useRef(false);

  // ?school= wins over the code remembered on this device (readable only once hydrated).
  const startCode = reauth
    ? reauth.schoolCode
    : hydrated
      ? (initialSchool ?? rememberedCode)
      : null;

  const lookUp = useCallback(async (raw: string) => {
    setSchoolCode(raw);
    setPending(true);
    const found = await findSchool(raw);
    setPending(false);
    if ('school' in found) {
      setSchoolCode(found.school.code);
      setPhase({ step: 'credentials', school: found.school });
    } else {
      setPhase({ step: 'school', error: found.error });
    }
  }, []);

  // Opens the first step: the reauth code step, or the credentials step for a known school.
  const begin = useCallback(
    (code: string) => {
      if (!reauth) return lookUp(code);
      return reauthPhase(reauth).then((next) => {
        if (next.step === 'code') {
          setLastCode(next.code);
          setSchoolCode(next.school.code);
        }
        setPhase(next);
      });
    },
    [reauth, lookUp],
  );

  useEffect(() => {
    // With a known code, open straight on step 2 (or on step 1 saying it wasn't found).
    if (!startCode || started.current) return;
    started.current = true;
    void begin(startCode);
  }, [startCode, begin]);

  let shown: Phase;
  if (phase) shown = phase;
  else if (!hydrated || startCode) shown = { step: 'loading' };
  else shown = { step: 'school' };

  const signedIn = useCallback(() => {
    remember(schoolCode);
    // A full load: the app shell renders fresh with the new cookie, and nothing cached while
    // signed out survives. `replace`, so Back does not return to the sign-in form.
    window.location.replace(nextPath);
  }, [remember, schoolCode, nextPath]);

  const card = { logo: <AuthLogo />, copyright: t('copyright') };

  if (shown.step === 'loading') {
    return (
      <AuthCard {...card} title={t('signIn.credentials.title')}>
        <p className="text-muted-foreground flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" />
          {t('signIn.loading')}
        </p>
      </AuthCard>
    );
  }

  if (shown.step === 'school') {
    return (
      <SchoolStep
        {...card}
        code={schoolCode}
        onCodeChange={(value) => {
          setSchoolCode(value);
          if (shown.error) setPhase({ step: 'school' });
        }}
        error={shown.error}
        pending={pending}
        autoFocus={moved}
        onSubmit={(error) => {
          setMoved(true);
          if (error) setPhase({ step: 'school', error });
          else void lookUp(schoolCode);
        }}
      />
    );
  }

  if (shown.step === 'credentials') {
    return (
      <CredentialsStep
        {...card}
        school={shown.school}
        initialError={shown.error}
        identifier={identifier}
        onIdentifierChange={setIdentifier}
        password={password}
        onPasswordChange={setPassword}
        keepSignedIn={keepSignedIn}
        onKeepSignedInChange={setKeepSignedIn}
        autoFocus={moved}
        onChangeSchool={() => {
          setMoved(true);
          setPhase({ step: 'school' });
        }}
        lastCode={lastCode}
        onCodeSent={(code) => {
          setMoved(true);
          setLastCode(code);
          setPhase({ step: 'code', school: shown.school, code });
        }}
        onSignedIn={signedIn}
      />
    );
  }

  return (
    <CodeStep
      {...card}
      schoolCode={shown.school.code}
      code={shown.code}
      keepSignedIn={keepSignedIn}
      onResent={(code) => {
        setLastCode(code);
        setPhase({ step: 'code', school: shown.school, code });
      }}
      onUsePassword={() => {
        setMoved(true);
        setPhase({ step: 'credentials', school: shown.school });
      }}
      onSignedIn={signedIn}
    />
  );
}
