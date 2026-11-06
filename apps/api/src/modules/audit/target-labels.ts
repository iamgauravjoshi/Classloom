import { sectionLabel } from '@classloom/contracts';

import type { Prisma } from '../../generated/prisma/client';
import { maskEmail } from '../tenancy/mask-email';

export interface AuditTarget {
  type: string;
  id: string;
}

/** The key of a target in the map `TargetLabels.resolve` returns. */
export const targetKey = (type: string, id: string): string => `${type}:${id}`;

type Tx = Prisma.TransactionClient;
type Lookup = (tx: Tx, ids: string[]) => Promise<[string, string][]>;

const byName =
  (find: (tx: Tx, ids: string[]) => Promise<{ id: string; name: string }[]>): Lookup =>
  async (tx, ids) =>
    (await find(tx, ids)).map((row) => [row.id, row.name]);

const inIds = (ids: string[]) => ({ where: { id: { in: ids } } });

/**
 * One query per target type. Every lookup runs on the caller's `withTenant` transaction, so
 * row-level security admits only this school's rows; `tenants` has no row-level security, so the
 * school lookup reads only the transaction's own tenant.
 */
const LOOKUPS: Record<string, Lookup> = {
  role: byName((tx, ids) => tx.role.findMany({ ...inIds(ids), select: { id: true, name: true } })),
  membership: async (tx, ids) =>
    (
      await tx.membership.findMany({
        ...inIds(ids),
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((row) => [row.id, row.user.name]),
  invitation: async (tx, ids) =>
    (await tx.invitation.findMany({ ...inIds(ids), select: { id: true, email: true } })).map(
      (row) => [row.id, maskEmail(row.email)],
    ),
  section: async (tx, ids) =>
    (
      await tx.section.findMany({
        ...inIds(ids),
        select: { id: true, classLevel: true, name: true },
      })
    ).map((row) => [row.id, sectionLabel(row.classLevel, row.name)]),
  stream: byName((tx, ids) =>
    tx.stream.findMany({ ...inIds(ids), select: { id: true, name: true } }),
  ),
  subject: byName((tx, ids) =>
    tx.subject.findMany({ ...inIds(ids), select: { id: true, name: true } }),
  ),
  house: byName((tx, ids) =>
    tx.house.findMany({ ...inIds(ids), select: { id: true, name: true } }),
  ),
  room: byName((tx, ids) => tx.room.findMany({ ...inIds(ids), select: { id: true, name: true } })),
  academic_year: async (tx, ids) =>
    (await tx.academicYear.findMany({ ...inIds(ids), select: { id: true, label: true } })).map(
      (row) => [row.id, row.label],
    ),
  campus: byName((tx, ids) =>
    tx.campus.findMany({ ...inIds(ids), select: { id: true, name: true } }),
  ),
  school: async (tx) =>
    (
      await tx.$queryRaw<{ id: string; name: string }[]>`
        SELECT id::text AS id, name FROM tenants
         WHERE id = current_setting('app.tenant_id')::uuid`
    ).map((row) => [row.id, row.name]),
};

/**
 * Read-time labels for audit targets (Part 6a spec section 5): a role's name, a member's name, an
 * invitation's masked email, a section's label, a stream, subject, house, room or campus name, a
 * year's label, the school's name. Null for a target that is gone, and for `class_level`,
 * `number_series` and `audit`, whose sentences read their details from the event itself.
 */
export const TargetLabels = {
  async resolve(tx: Tx, targets: readonly AuditTarget[]): Promise<Map<string, string | null>> {
    const idsByType = new Map<string, Set<string>>();
    for (const { type, id } of targets) {
      const ids = idsByType.get(type) ?? new Set<string>();
      ids.add(id.toLowerCase());
      idsByType.set(type, ids);
    }
    const labels = new Map<string, string | null>();
    for (const { type, id } of targets) labels.set(targetKey(type, id), null);

    for (const [type, ids] of idsByType) {
      const lookup = LOOKUPS[type];
      if (!lookup) continue;
      const found = new Map(
        (await lookup(tx, [...ids])).map(([id, label]) => [id.toLowerCase(), label]),
      );
      for (const { type: t, id } of targets) {
        if (t === type) labels.set(targetKey(t, id), found.get(id.toLowerCase()) ?? null);
      }
    }
    return labels;
  },
};
