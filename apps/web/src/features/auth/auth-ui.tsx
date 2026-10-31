import { IconSchool } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

/** Shared sizing: comfortable on desktop, at least 44 px on coarse pointers. */
export const CONTROL_CLASS = 'h-10 pointer-coarse:h-11';
export const BUTTON_CLASS = 'h-10 px-4 pointer-coarse:h-11';
/** A text link with enough contrast in both themes and a 44 px target on touch. */
export const LINK_CLASS =
  'text-primary-text font-medium underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center';

/** The brand mark above the auth card: the same icon and name as the registration pages. */
export function AuthLogo() {
  const t = useTranslations('app');
  return (
    <span className="flex items-center gap-2 text-lg font-semibold">
      <IconSchool size={28} className="text-primary-text" aria-hidden="true" />
      {t('name')}
    </span>
  );
}
