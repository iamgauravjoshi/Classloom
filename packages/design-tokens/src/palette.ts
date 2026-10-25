/** Raw colour ramps from the PreSkool Figma "Colors" frame (node 5028:565054). */
type Step = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type Ramp = Readonly<Record<Step, string>>;

const STEPS: readonly Step[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const ramp = (...hex: string[]): Ramp =>
  Object.fromEntries(STEPS.map((step, i) => [step, hex[i]])) as Ramp;

export const brand = {
  primary: '#3D5EE1',
  secondary: '#6FCCD8',
  dark: '#131022',
  light: '#E9EDF4',
  white: '#FFFFFF',
} as const;

export const system = {
  info: '#0F65CD',
  success: '#1ABE17',
  warning: '#EAB300',
  danger: '#E82646',
  sky: '#05C3FB',
} as const;

export const theme = {
  violet: '#673AB7',
  pink: '#E83E8C',
  orange: '#FD7E14',
  green: '#2CA87F',
  red: '#DC2626',
} as const;

/** Figma "Brand Transparent" tints, used behind status text. */
export const tint = {
  primary: '#F2F5FF',
  secondary: '#E8FCFF',
  dark: '#F3F6FF',
  warning: '#FEF8EA',
  info: '#E7F1FC',
  success: '#E8F9E8',
  danger: '#FDE9ED',
  sky: '#E6F9FF',
} as const;

export const palette = {
  grey: ramp(
    '#E6E8EB',
    '#CDD0D7',
    '#B5B9C3',
    '#9CA1AF',
    '#838A9B',
    '#6A7287',
    '#515B73',
    '#39435F',
    '#202C4B',
  ),
  light: ramp(
    '#FDFDFE',
    '#FBFBFD',
    '#F8FAFC',
    '#F6F8FB',
    '#F4F6FA',
    '#F2F4F8',
    '#F0F2F7',
    '#EDF1F6',
    '#E9EDF4',
  ),
  // Figma lists Dark 900 to 100 from darkest to lightest; reordered so 100 is the lightest, like every other ramp.
  dark: ramp(
    '#EFEFF2',
    '#DBDADF',
    '#B9B7C0',
    '#8C8997',
    '#5B576B',
    '#322D46',
    '#1B1632',
    '#131022',
    '#0F0C1C',
  ),
  primary: ramp(
    '#ECEFFC',
    '#D8DFF9',
    '#C5CFF6',
    '#B1BFF3',
    '#9EAFF0',
    '#8B9EED',
    '#778EEA',
    '#647EE7',
    '#506EE4',
  ),
  secondary: ramp(
    '#F1FAFB',
    '#E2F5F7',
    '#D4F0F3',
    '#C5EBEF',
    '#B7E6EC',
    '#A9E0E8',
    '#9ADBE4',
    '#8CD6E0',
    '#7DD1DC',
  ),
  warning: ramp(
    '#FEF8EA',
    '#FDF1D6',
    '#FDE9C1',
    '#FCE2AD',
    '#FBDB98',
    '#FAD483',
    '#F9CD6F',
    '#F9C55A',
    '#F7B731',
  ),
  info: ramp(
    '#E7F1FC',
    '#CFE2FA',
    '#B8D4F7',
    '#A0C6F4',
    '#88B8F2',
    '#70A9EF',
    '#589BEC',
    '#418DE9',
    '#1170E4',
  ),
  success: ramp(
    '#E8F9E8',
    '#D1F2D1',
    '#BAECB9',
    '#A3E5A2',
    '#8DDF8B',
    '#76D874',
    '#5FD25D',
    '#48CB45',
    '#2ACB27',
  ),
  danger: ramp(
    '#FDE9ED',
    '#FAD4DA',
    '#F8BEC8',
    '#F6A8B5',
    '#F493A3',
    '#F17D90',
    '#EF677E',
    '#ED516B',
    '#E82646',
  ),
  sky: ramp(
    '#E6F9FF',
    '#CDF3FE',
    '#B4EDFE',
    '#9BE7FD',
    '#82E1FD',
    '#69DBFD',
    '#50D5FC',
    '#37CFFC',
    '#1ECCFF',
  ),
  violet: ramp(
    '#F0EBF8',
    '#E1D8F1',
    '#D1C4E9',
    '#C2B0E2',
    '#B39DDB',
    '#A489D4',
    '#9575CD',
    '#8561C5',
    '#764EBE',
  ),
  pink: ramp(
    '#FDECF4',
    '#FAD8E8',
    '#FAD8E8',
    '#F6B2D1',
    '#F49FC6',
    '#F18BBA',
    '#EF78AF',
    '#ED65A3',
    '#EA5198',
  ),
  orange: ramp(
    '#FFF2E8',
    '#FFE5D0',
    '#FED8B9',
    '#FECBA1',
    '#FEBF8A',
    '#FEB272',
    '#FEA55B',
    '#FD9843',
    '#FD8B2C',
  ),
  green: ramp(
    '#EAF6F2',
    '#D5EEE5',
    '#C0E5D9',
    '#ABDCCC',
    '#96D4BF',
    '#80CBB2',
    '#6BC2A5',
    '#56B999',
    '#41B18C',
  ),
  red: ramp(
    '#FCE9E9',
    '#F8D4D4',
    '#F5BEBE',
    '#F1A8A8',
    '#EE9393',
    '#EA7D7D',
    '#E76767',
    '#E35151',
    '#E03C3C',
  ),
} as const;

export type RampName = keyof typeof palette;
export { STEPS };
