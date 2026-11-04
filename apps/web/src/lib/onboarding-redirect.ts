/**
 * Whether the dashboard sends this person to the setup wizard (spec §9): only someone who manages
 * settings, and only while the school has never opened it. Opening the wizard records the start,
 * so it never redirects again and the dashboard's checklist card takes over.
 */
export function shouldOpenWizard(input: { canManage: boolean; startedAt: string | null }): boolean {
  return input.canManage && input.startedAt === null;
}
