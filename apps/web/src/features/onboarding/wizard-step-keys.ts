/** The wizard's steps, in order; the keys are the checklist's (`GET /school/onboarding`). */
export const WIZARD_STEPS = ['profile', 'logo', 'academicYear', 'campuses'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Whether a `?step=` value names a step (the server page reads it). */
export const isWizardStep = (value: unknown): value is WizardStep =>
  typeof value === 'string' && (WIZARD_STEPS as readonly string[]).includes(value);
