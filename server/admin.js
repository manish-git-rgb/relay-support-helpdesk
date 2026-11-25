import { connect } from './db.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('Usage: npm run admin -- registered-email');
const pool = connect();
try {
  const result = await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  if (!result.rowCount) throw new Error('Register this account first');
  console.log('Administrator access granted');
} finally {
  await pool.end();
}
