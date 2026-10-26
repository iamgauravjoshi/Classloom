import { blend } from './contrast';
import { brand, palette, system, theme, tint } from './palette';

/** Hues that have a `-tint` background and a `-strong` text colour (status pills, icon tiles). */
export const STATUS_HUES = [
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
  'info',
  'sky',
  'violet',
  'pink',
  'orange',
  'green',
  'red',
] as const;
export type StatusHue = (typeof STATUS_HUES)[number];

export const BASE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'muted',
  'muted-foreground',
  'subtle-foreground',
  'border',
  'input',
  'primary',
  'primary-foreground',
  'primary-text',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'ring',
  'sidebar',
  'sidebar-foreground',
] as const;
type BaseToken = (typeof BASE_TOKENS)[number];

export type SemanticToken = BaseToken | `${StatusHue}-tint` | `${StatusHue}-strong`;
export type SemanticTheme = Readonly<Record<SemanticToken, string>>;

const DARK_CARD = palette.dark[700];

/** The saturated colour of each hue, used for icons, charts and dark-mode tints. */
export const baseHue: Readonly<Record<StatusHue, string>> = {
  primary: brand.primary,
  secondary: brand.secondary,
  success: system.success,
  warning: system.warning,
  danger: system.danger,
  info: system.info,
  sky: system.sky,
  violet: theme.violet,
  pink: theme.pink,
  orange: theme.orange,
  green: theme.green,
  red: theme.red,
};

const lightTint: Record<StatusHue, string> = {
  primary: tint.primary,
  secondary: tint.secondary,
  success: tint.success,
  warning: tint.warning,
  danger: tint.danger,
  info: tint.info,
  sky: tint.sky,
  violet: palette.violet[100],
  pink: palette.pink[100],
  orange: palette.orange[100],
  green: palette.green[100],
  red: palette.red[100],
};

/**
 * Light-mode text: the darkest shade of each hue that reaches 4.5:1 on its tint. Several raw Figma
 * colours (success, warning, sky, secondary...) are too light to be read as text.
 */
const lightStrong: Record<StatusHue, string> = {
  primary: brand.primary,
  secondary: '#437A82',
  success: '#128110',
  warning: '#8F6D00',
  danger: '#D1223F',
  info: system.info,
  sky: '#03799C',
  violet: theme.violet,
  pink: '#C33476',
  orange: '#AF570E',
  green: '#207C5E',
  red: '#D12424',
};

/** Dark-mode text: the 500 step of each ramp (600 for primary, so links stay 4.5:1 on the active-nav background). */
const darkStrong: Record<StatusHue, string> = {
  primary: palette.primary[600],
  secondary: palette.secondary[500],
  success: palette.success[500],
  warning: palette.warning[500],
  danger: palette.danger[500],
  info: palette.info[500],
  sky: palette.sky[500],
  violet: palette.violet[500],
  pink: palette.pink[500],
  orange: palette.orange[500],
  green: palette.green[500],
  red: palette.red[500],
};

/** Dark-mode tints: each hue at 15% over the dark card, as an opaque colour so contrast can be measured. */
const darkTint = Object.fromEntries(
  STATUS_HUES.map((hue) => [hue, blend(baseHue[hue], DARK_CARD, 0.15)]),
) as Record<StatusHue, string>;

function hueTokens(tints: Record<StatusHue, string>, strongs: Record<StatusHue, string>) {
  const out = {} as Record<`${StatusHue}-tint` | `${StatusHue}-strong`, string>;
  for (const hue of STATUS_HUES) {
    out[`${hue}-tint`] = tints[hue];
    out[`${hue}-strong`] = strongs[hue];
  }
  return out;
}

const light: SemanticTheme = {
  background: palette.light[500],
  foreground: palette.grey[900],
  card: brand.white,
  'card-foreground': palette.grey[900],
  popover: brand.white,
  'popover-foreground': palette.grey[900],
  muted: palette.light[700],
  'muted-foreground': palette.grey[700],
  'subtle-foreground': palette.grey[600],
  border: palette.grey[100],
  // Input borders identify the field, so they need 3:1 (WCAG 1.4.11); card borders stay soft.
  input: palette.grey[500],
  primary: brand.primary,
  'primary-foreground': brand.white,
  'primary-text': brand.primary,
  secondary: brand.secondary,
  'secondary-foreground': brand.dark,
  accent: tint.primary,
  'accent-foreground': brand.primary,
  // Figma danger #E82646 gives 4.38:1 with white text; this is the nearest shade that passes.
  destructive: '#E32545',
  'destructive-foreground': brand.white,
  ring: brand.primary,
  sidebar: brand.white,
  'sidebar-foreground': palette.grey[900],
  ...hueTokens(lightTint, lightStrong),
};

const dark: SemanticTheme = {
  background: palette.dark[900],
  foreground: palette.dark[100],
  card: DARK_CARD,
  'card-foreground': palette.dark[100],
  popover: DARK_CARD,
  'popover-foreground': palette.dark[100],
  muted: palette.dark[600],
  'muted-foreground': palette.dark[300],
  'subtle-foreground': palette.dark[400],
  border: palette.dark[600],
  input: palette.dark[400],
  primary: brand.primary,
  'primary-foreground': brand.white,
  'primary-text': palette.primary[600],
  secondary: brand.secondary,
  'secondary-foreground': brand.dark,
  accent: palette.dark[600],
  'accent-foreground': palette.primary[600],
  destructive: '#E32545',
  'destructive-foreground': brand.white,
  ring: palette.primary[600],
  sidebar: DARK_CARD,
  'sidebar-foreground': palette.dark[100],
  ...hueTokens(darkTint, darkStrong),
};

export const semantic = { light, dark } as const;
