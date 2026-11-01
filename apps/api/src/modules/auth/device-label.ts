import Bowser from 'bowser';

const UNKNOWN = 'Unknown device';

/** "{Browser} on {OS}" from a User-Agent, or "Unknown device". */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return UNKNOWN;
  try {
    const parsed = Bowser.parse(userAgent);
    const browser = parsed.browser.name;
    const os = parsed.os.name;
    if (!browser || !os) return UNKNOWN;
    return `${browser} on ${os}`;
  } catch {
    return UNKNOWN;
  }
}
