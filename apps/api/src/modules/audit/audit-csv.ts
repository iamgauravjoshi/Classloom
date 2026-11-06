import type { AuditEvent } from '@classloom/contracts';

export const CSV_HEADER = [
  'time (IST, DD/MM/YYYY HH:mm)',
  'person',
  'action',
  'target',
  'changes',
  'ip',
  'device',
] as const;

/** The target types whose label is null by design, not because the target is gone. */
const UNLABELLED_TYPES = new Set(['class_level', 'number_series', 'audit']);

/** The UTF-8 byte-order mark. */
const BOM = String.fromCharCode(0xfeff);

const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** `DD/MM/YYYY HH:mm` in India Standard Time (UTC+05:30, no daylight saving). */
export function istDateTime(iso: string): string {
  const t = new Date(Date.parse(iso) + IST_OFFSET_MS);
  return (
    `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ` +
    `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`
  );
}

/** A changed value as text: `—` for none, strings as they are, anything else as JSON. */
function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Cells a spreadsheet would run as a formula (OWASP CSV injection), plus tab and CR. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One RFC 4180 cell: a cell a spreadsheet would read as a formula gets a leading `'`, and a cell
 * holding a comma, quote, CR or LF is quoted with its quotes doubled.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function targetText(target: AuditEvent['target']): string {
  if (target.label !== null) return target.label;
  return UNLABELLED_TYPES.has(target.type) ? target.type : `${target.type} (deleted)`;
}

function row(event: AuditEvent): string[] {
  return [
    istDateTime(event.createdAt),
    event.actor?.name ?? 'System',
    event.action,
    targetText(event.target),
    event.changes
      .map((c) => `${c.field}: ${valueText(c.before)} → ${valueText(c.after)}`)
      .join('; '),
    event.ip ?? '',
    event.device ?? '',
  ];
}

/**
 * The audit export: a UTF-8 byte-order mark (so spreadsheets read names in any script), the
 * header, then one CRLF-terminated row per event in the order given.
 */
export function auditCsv(events: readonly AuditEvent[]): string {
  const lines = [[...CSV_HEADER], ...events.map(row)].map(
    (cells) => `${cells.map(csvCell).join(',')}\r\n`,
  );
  return BOM + lines.join('');
}
