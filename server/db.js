import pg from 'pg';
import { readFile } from 'node:fs/promises';

export function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool) {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(520610)');
    await client.query(schema);
  });
}
