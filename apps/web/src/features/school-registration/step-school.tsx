'use client';

import { BOARDS, INDIAN_STATES } from '@classloom/contracts';
import { Field, FieldError, FieldGroup, FieldLabel } from '@classloom/ui/components/ui/field';
import { Input } from '@classloom/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@classloom/ui/components/ui/select';
import { cn } from '@classloom/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { CONTROL_CLASS, type StepProps } from './form-types';

const TRIGGER_CLASS = cn('w-full', CONTROL_CLASS, 'data-[size=default]:h-10');

export function StepSchool({ values, errors, onChange }: StepProps) {
  const t = useTranslations('registration');
  const boards = useMemo(
    () => BOARDS.map((board) => ({ value: board, label: t(`boards.${board}`) })),
    [t],
  );
  const states = useMemo(
    () => INDIAN_STATES.map((state) => ({ value: state.code, label: state.name })),
    [],
  );

  return (
    <FieldGroup>
      <Field data-invalid={Boolean(errors.schoolName)}>
        <FieldLabel htmlFor="schoolName">{t('fields.schoolName')}</FieldLabel>
        <Input
          id="schoolName"
          name="schoolName"
          autoComplete="organization"
          className={CONTROL_CLASS}
          placeholder={t('fields.schoolNamePlaceholder')}
          value={values.schoolName}
          aria-invalid={Boolean(errors.schoolName)}
          onChange={(event) => onChange('schoolName', event.target.value)}
        />
        <FieldError>{errors.schoolName}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.board)}>
        <FieldLabel htmlFor="board">{t('fields.board')}</FieldLabel>
        <Select
          items={boards}
          value={values.board || null}
          onValueChange={(value) => onChange('board', value ?? '')}
        >
          <SelectTrigger id="board" className={TRIGGER_CLASS} aria-invalid={Boolean(errors.board)}>
            <SelectValue placeholder={t('fields.boardPlaceholder')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {boards.map((board) => (
              <SelectItem key={board.value} value={board.value} className="pointer-coarse:py-2.5">
                {board.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{errors.board}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.city)}>
        <FieldLabel htmlFor="city">{t('fields.city')}</FieldLabel>
        <Input
          id="city"
          name="city"
          autoComplete="address-level2"
          className={CONTROL_CLASS}
          placeholder={t('fields.cityPlaceholder')}
          value={values.city}
          aria-invalid={Boolean(errors.city)}
          onChange={(event) => onChange('city', event.target.value)}
        />
        <FieldError>{errors.city}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.state)}>
        <FieldLabel htmlFor="state">{t('fields.state')}</FieldLabel>
        <Select
          items={states}
          value={values.state || null}
          onValueChange={(value) => onChange('state', value ?? '')}
        >
          <SelectTrigger id="state" className={TRIGGER_CLASS} aria-invalid={Boolean(errors.state)}>
            <SelectValue placeholder={t('fields.statePlaceholder')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {states.map((state) => (
              <SelectItem key={state.value} value={state.value} className="pointer-coarse:py-2.5">
                {state.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError>{errors.state}</FieldError>
      </Field>
    </FieldGroup>
  );
}
