import { Client } from 'pg';

import { startTestInfra, type TestInfra } from './setup-containers';

describe('database roles', () => {
  let infra: TestInfra;
  let client: Client;

  beforeAll(async () => {
    infra = await startTestInfra();
    client = new Client({ connectionString: infra.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await infra?.stop();
  });

  it('connects as the restricted app role', async () => {
    const res = await client.query<{ current_user: string }>('SELECT current_user');
    expect(res.rows[0]?.current_user).toBe('classloom_app');
  });

  it('does not let the app role bypass row-level security', async () => {
    const res = await client.query<{ rolbypassrls: boolean }>(
      'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(res.rows[0]?.rolbypassrls).toBe(false);
  });

  it('does not let the app role create tables', async () => {
    await expect(client.query('CREATE TABLE x (id int)')).rejects.toThrow(/permission denied/);
  });

  it('lets the owner role bypass RLS and create databases for migrations', async () => {
    const owner = new Client({ connectionString: infra.env.DATABASE_MIGRATION_URL });
    await owner.connect();
    try {
      const res = await owner.query<{ rolbypassrls: boolean; rolcreatedb: boolean }>(
        'SELECT rolbypassrls, rolcreatedb FROM pg_roles WHERE rolname = current_user',
      );
      expect(res.rows[0]).toEqual({ rolbypassrls: true, rolcreatedb: true });
    } finally {
      await owner.end();
    }
  });
});
