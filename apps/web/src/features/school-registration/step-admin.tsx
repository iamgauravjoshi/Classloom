'use client';

import { Checkbox } from '@classloom/ui/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

import { CONTROL_CLASS, type StepProps } from './form-types';

const linkClass = 'text-primary-text underline underline-offset-4';

const legalLink = (href: '/terms' | '/privacy') =>
  function LegalLink(chunks: ReactNode) {
    return (
      <Link href={href} target="_blank" className={linkClass}>
        {chunks}
      </Link>
    );
  };

export function StepAdmin({ values, errors, onChange }: StepProps) {
  const t = useTranslations('registration');

  return (
    <FieldGroup>
      <Field data-invalid={Boolean(errors.adminName)}>
        <FieldLabel htmlFor="adminName">{t('fields.adminName')}</FieldLabel>
        <Input
          id="adminName"
          name="adminName"
          autoComplete="name"
          className={CONTROL_CLASS}
          value={values.adminName}
          aria-invalid={Boolean(errors.adminName)}
          onChange={(event) => onChange('adminName', event.target.value)}
        />
        <FieldError>{errors.adminName}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.email)}>
        <FieldLabel htmlFor="email">{t('fields.email')}</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className={CONTROL_CLASS}
          value={values.email}
          aria-invalid={Boolean(errors.email)}
          onChange={(event) => onChange('email', event.target.value)}
        />
        <FieldDescription>{t('fields.emailHint')}</FieldDescription>
        <FieldError>{errors.email}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.mobile)}>
        <FieldLabel htmlFor="mobile">{t('fields.mobile')}</FieldLabel>
        <Input
          id="mobile"
          name="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          className={CONTROL_CLASS}
          value={values.mobile}
          aria-invalid={Boolean(errors.mobile)}
          onChange={(event) => onChange('mobile', event.target.value)}
        />
        <FieldDescription>{t('fields.mobileHint')}</FieldDescription>
        <FieldError>{errors.mobile}</FieldError>
      </Field>

      <Field orientation="horizontal" data-invalid={Boolean(errors.acceptTerms)}>
        <Checkbox
          id="acceptTerms"
          name="acceptTerms"
          checked={values.acceptTerms}
          aria-labelledby="acceptTerms-label"
          aria-invalid={Boolean(errors.acceptTerms)}
          onCheckedChange={(checked) => onChange('acceptTerms', checked)}
          className="pointer-coarse:size-6"
        />
        <div className="flex flex-col gap-1">
          <label id="acceptTerms-label" htmlFor="acceptTerms" className="text-sm leading-snug">
            {t.rich('terms.label', {
              terms: legalLink('/terms'),
              privacy: legalLink('/privacy'),
            })}
          </label>
          <FieldError>{errors.acceptTerms}</FieldError>
        </div>
      </Field>
    </FieldGroup>
  );
}
