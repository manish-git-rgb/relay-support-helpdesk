import { createApp } from './app.js';
import { connect, migrate } from './db.js';

const pool = connect();
const app = createApp(pool, process.env.JWT_SECRET, { trustProxy: process.env.TRUST_PROXY === '1' });
await migrate(pool);
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log('Helpdesk listening on port', port));
