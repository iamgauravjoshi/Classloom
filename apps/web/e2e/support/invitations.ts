import { randomInt } from 'node:crypto';

import { type APIRequestContext, expect } from '@playwright/test';

import { latestEmailTo, mailIds, verificationLink } from './mailpit';
import { WEB_ORIGIN } from './school';

export interface Invitee {
  email: string;
  name: string;
}

/** A new address and name for an invitee; unique per call. */
export function newInvitee(name = 'Ravi Kumar'): Invitee {
  return { email: `invitee-e2e-${randomInt(1e9).toString(36)}@example.com`, name };
}

/**
 * Invites `invitee` as `roleName` from a request context signed in as the school's owner (use
 * `signInWithCode`, which also lets the owner manage roles), and returns the emailed join link.
 */
export async function inviteAs(
  owner: APIRequestContext,
  invitee: Invitee,
  roleName = 'Teacher',
): Promise<string> {
  const roles = await owner.get(`${WEB_ORIGIN}/api/iam/roles`);
  expect(roles.status(), await roles.text()).toBe(200);
  const role = ((await roles.json()) as { roles: { id: string; name: string }[] }).roles.find(
    (candidate) => candidate.name === roleName,
  );
  expect(role, `role ${roleName}`).toBeDefined();

  const before = await mailIds(owner, invitee.email);
  const created = await owner.post(`${WEB_ORIGIN}/api/iam/invitations`, {
    data: { email: invitee.email, name: invitee.name, roleIds: [role?.id] },
    headers: { origin: WEB_ORIGIN },
  });
  expect(created.status(), await created.text()).toBe(201);

  const { text } = await latestEmailTo(owner, invitee.email, /invited to join/, undefined, before);
  return verificationLink(text);
}
