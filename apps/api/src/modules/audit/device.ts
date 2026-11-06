import Bowser from 'bowser';

/**
 * A short "{browser} on {device}" for an audit row's stored User-Agent: `Chrome on Windows`,
 * `Safari on iPhone`, `Firefox on Android`. An Apple phone or tablet is named by its model
 * (iPhone, iPad); everything else by its OS. Null when there is no agent or it cannot be read.
 */
export function deviceOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  try {
    const parsed = Bowser.parse(userAgent);
    const browser = parsed.browser.name;
    const os = parsed.os.name;
    if (!browser || !os) return null;
    const model = parsed.platform.model;
    const device = os === 'iOS' && model ? model : os;
    return `${browser} on ${device}`;
  } catch {
    return null;
  }
}
