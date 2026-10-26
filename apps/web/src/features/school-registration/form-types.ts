/** Raw (un-normalised) form values; every control is a string except the terms checkbox. */
export interface FormValues {
  schoolName: string;
  board: string;
  city: string;
  state: string;
  code: string;
  adminName: string;
  email: string;
  mobile: string;
  acceptTerms: boolean;
}

export type FieldName = keyof FormValues;
export type FieldErrors = Partial<Record<FieldName, string>>;
export type TextFieldName = Exclude<FieldName, 'acceptTerms'>;

export const EMPTY_VALUES: FormValues = {
  schoolName: '',
  board: '',
  city: '',
  state: '',
  code: '',
  adminName: '',
  email: '',
  mobile: '',
  acceptTerms: false,
};

export const TEXT_FIELDS: readonly TextFieldName[] = [
  'schoolName',
  'board',
  'city',
  'state',
  'code',
  'adminName',
  'email',
  'mobile',
];

export type Step = 1 | 2 | 3;

export const FIELD_STEP: Record<FieldName, Step> = {
  schoolName: 1,
  board: 1,
  city: 1,
  state: 1,
  code: 2,
  adminName: 3,
  email: 3,
  mobile: 3,
  acceptTerms: 3,
};

/** Availability of the typed code, as the form needs it. */
export type CodeStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'unknown';

export interface StepProps {
  values: FormValues;
  errors: FieldErrors;
  onChange: <K extends FieldName>(field: K, value: FormValues[K]) => void;
}

/** Shared sizing: comfortable on desktop, at least 44px on coarse pointers. */
export const CONTROL_CLASS = 'h-10 pointer-coarse:h-11';
export const BUTTON_CLASS = 'h-10 px-4 pointer-coarse:h-11';
