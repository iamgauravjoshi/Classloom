'use client';

import {
  type InvitationPreviewDto,
  useAcceptInvitation,
  useGetMe,
  usePreviewInvitation,
  useSignOut,
} from '@classloom/api-client';
import { AuthCard } from '@classloom/ui/components/auth-card';
import { Alert, AlertDescription } from '@classloom/ui/components/ui/alert';
import { Button, buttonVariants } from '@classloom/ui/components/ui/button';
import { Spinner } from '@classloom/ui/components/ui/spinner';
import { cn } from '@classloom/ui/lib/utils';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { leavesAfterSignOut } from '@/lib/sign-out';

import { AuthLogo, BUTTON_CLASS } from '../auth/auth-ui';
import { TwoFactorStep } from '../auth/two-factor-step';
import { isOtherAccount } from './invitee';
import { acceptOutcomeOf, acceptResultOf, type JoinErrorKey, previewErrorKey } from './join-errors';

interface JoinFlowProps {
  /** The address of whoever is signed in in this browser (read by the page), if anyone. */
  signedInEmail: string | null;
}

type Phase =
  | { step: 'invitation' }
  | { step: 'gone' }
  | { step: 'alreadyMember' }
  | { step: 'joined'; schoolCode: string | null }
  | { step: 'two-factor'; challenge: string; expiresAt: number }
  | { step: 'welcome' };

const strong = (chunks: ReactNode) => (
  <strong className="text-foreground font-semibold">{chunks}</strong>
);

/**
 * Joining a school from an emailed invitation. The token leaves the address bar on load and
 * stays in memory; opening the link only previews it (a mail scanner spends nothing). The token is
 * spent by **Join**, which signs the person in: straight to a welcome, or through the two-step
 * code first.
 */
export function JoinFlow({ signedInEmail }: JoinFlowProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  // Captured on first render, before the effect removes it from the address bar.
  const [token] = useState(() => searchParams.get('token'));
  const [phase, setPhase] = useState<Phase>({ step: 'invitation' });
  const [failure, setFailure] = useState<JoinErrorKey | null>(null);
  // Set once the other person has been signed out here: the invitation is then for nobody else.
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    if (!window.location.search.includes('token=')) return;
    // Keeps the token out of history, bookmarks, screenshots and the Referer of later requests.
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  const preview = usePreviewInvitation(
    { token: token ?? '' },
    {
      query: {
        enabled: Boolean(token),
        // A spent link answers 410 every time: only an outage is worth another try.
        retry: (count, error) => previewErrorKey(error) !== 'gone' && count < 1,
        staleTime: Infinity,
        gcTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  );
  // No caching: the token must not outlive the request in the mutation cache.
  const accept = useAcceptInvitation({ mutation: { gcTime: 0 } });
  const signOut = useSignOut();

  const card = { logo: <AuthLogo />, copyright: t('copyright') };

  async function join() {
    if (!token || accept.isPending) return;
    setFailure(null);
    try {
      const result = await accept.mutateAsync({ data: { token } });
      const next = acceptResultOf(result);
      if (next.kind === 'challenge') {
        setPhase({ step: 'two-factor', challenge: next.challenge, expiresAt: next.expiresAt });
      } else {
        setPhase({ step: 'welcome' });
      }
    } catch (error) {
      const outcome = acceptOutcomeOf(error);
      if (outcome.kind === 'gone') setPhase({ step: 'gone' });
      else if (outcome.kind === 'alreadyMember') setPhase({ step: 'alreadyMember' });
      else if (outcome.kind === 'joined') {
        setPhase({ step: 'joined', schoolCode: outcome.schoolCode });
      } else setFailure(outcome.key);
    }
  }

  async function signOutAndJoin() {
    if (signOut.isPending || accept.isPending) return;
    setFailure(null);
    try {
      await signOut.mutateAsync();
    } catch (error) {
      // A 401 means that session had already ended, which is what was wanted.
      if (!leavesAfterSignOut(error)) {
        setFailure('generic');
        return;
      }
    }
    setSignedOut(true);
    await join();
  }

  const invalid = (
    <AuthCard
      {...card}
      title={t('join.gone.title')}
      description={t('join.gone.body')}
      footer={
        <Link href="/sign-in" className="text-primary-text font-medium hover:underline">
          {t('join.gone.signIn')}
        </Link>
      }
    >
      {null}
    </AuthCard>
  );

  if (phase.step === 'gone' || !token) return invalid;

  if (phase.step === 'two-factor') {
    return (
      <TwoFactorStep
        {...card}
        challenge={{ challenge: phase.challenge, expiresAt: phase.expiresAt }}
        // The invitation is spent: signing in is what is left.
        onStartAgain={() => {
          router.replace(`/sign-in${schoolQuery(preview.data)}`);
        }}
        onSignedIn={() => setPhase({ step: 'welcome' })}
      />
    );
  }

  if (preview.isPending) {
    return (
      <AuthCard {...card} title={t('join.title')}>
        <p className="text-muted-foreground flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" />
          {t('join.loading')}
        </p>
      </AuthCard>
    );
  }

  if (preview.isError) {
    const key = previewErrorKey(preview.error);
    if (key === 'gone') return invalid;
    return (
      <AuthCard {...card} title={t('join.title')}>
        <Alert variant="destructive">
          <AlertDescription role="alert">{t(`errors.${key}`)}</AlertDescription>
        </Alert>
        <Button className={cn(BUTTON_CLASS, 'w-full')} onClick={() => void preview.refetch()}>
          {t('join.retry')}
        </Button>
      </AuthCard>
    );
  }

  const invitation = preview.data;

  if (phase.step === 'alreadyMember') {
    return (
      <AuthCard
        {...card}
        title={t('join.alreadyMember.title', { school: invitation.school.name })}
        description={t('join.alreadyMember.body')}
      >
        <Link
          href={`/sign-in?school=${encodeURIComponent(invitation.school.code)}`}
          className={cn(buttonVariants(), BUTTON_CLASS, 'w-full')}
        >
          {t('join.alreadyMember.signIn')}
        </Link>
      </AuthCard>
    );
  }

  if (phase.step === 'joined') {
    // The link is spent and the seat is theirs, but no session came of it: sign in.
    const code = phase.schoolCode ?? invitation.school.code;
    return (
      <AuthCard
        {...card}
        title={t('join.joined.title', { school: invitation.school.name })}
        description={t('join.joined.body')}
      >
        <Link
          href={`/sign-in?school=${encodeURIComponent(code)}`}
          className={cn(buttonVariants(), BUTTON_CLASS, 'w-full')}
        >
          {t('join.joined.signIn')}
        </Link>
      </AuthCard>
    );
  }

  if (phase.step === 'welcome') return <Welcome school={invitation.school.name} card={card} />;

  const other = !signedOut && isOtherAccount(invitation.email, signedInEmail);
  const busy = accept.isPending || signOut.isPending;
  const error = failure ? <FailureAlert text={t(`errors.${failure}`)} /> : null;

  if (other) {
    return (
      <AuthCard
        {...card}
        title={t('join.otherAccount.title', { email: invitation.email })}
        description={t('join.otherAccount.body', { school: invitation.school.name })}
      >
        {error}
        <Button
          className={cn(BUTTON_CLASS, 'w-full')}
          disabled={busy}
          onClick={() => void signOutAndJoin()}
        >
          {busy ? <Spinner aria-hidden="true" /> : null}
          {busy ? t('join.otherAccount.working') : t('join.otherAccount.action')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      {...card}
      title={t('join.title')}
      description={t.rich('join.invitation', {
        school: invitation.school.name,
        roles: invitation.roles.join(', '),
        strong,
      })}
    >
      <p className="text-muted-foreground -mt-3 text-sm">
        {t('join.forPerson', { name: invitation.name, email: invitation.email })}
      </p>
      {error}
      <Button className={cn(BUTTON_CLASS, 'w-full')} disabled={busy} onClick={() => void join()}>
        {busy ? <Spinner aria-hidden="true" /> : null}
        {busy ? t('join.joining') : t('join.join')}
      </Button>
    </AuthCard>
  );
}

function FailureAlert({ text }: { text: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription role="alert">{text}</AlertDescription>
    </Alert>
  );
}

function schoolQuery(preview: InvitationPreviewDto | undefined): string {
  return preview ? `?school=${encodeURIComponent(preview.school.code)}` : '';
}

/** "Welcome to …": for a person with no password, the offer to set one, else just Continue. */
function Welcome({
  school,
  card,
}: {
  school: string;
  card: { logo: ReactNode; copyright: string };
}) {
  const t = useTranslations('auth.join.welcome');
  const tJoin = useTranslations('auth.join');
  const locale = useLocale();
  const me = useGetMe();
  const noPassword = me.data?.hasPassword === false;

  return (
    <AuthCard
      {...card}
      title={t('title', { school })}
      description={noPassword ? t('body') : t('bodyDone')}
    >
      {me.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2" role="status">
          <Spinner aria-hidden="true" />
          {tJoin('loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {noPassword ? (
            <a href={`/${locale}/account`} className={cn(buttonVariants(), BUTTON_CLASS, 'w-full')}>
              {t('setPassword')}
            </a>
          ) : null}
          {/* A full load: the app shell renders fresh with the new session. */}
          <a
            href={`/${locale}/dashboard`}
            className={cn(
              buttonVariants({ variant: noPassword ? 'outline' : 'default' }),
              BUTTON_CLASS,
              'w-full',
            )}
          >
            {t('continue')}
          </a>
        </div>
      )}
    </AuthCard>
  );
}
