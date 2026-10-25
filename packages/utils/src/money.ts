const withDecimals = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats an amount held in paise as Indian rupees with lakh/crore grouping, e.g. `₹1,23,456.78`. */
export function formatINR(paise: number, opts: { decimals?: boolean } = {}): string {
  const formatter = opts.decimals === false ? wholeRupees : withDecimals;
  return formatter.format(paise / 100);
}
