import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { authRoutes, authenticate } from './auth.js';
import { ticketRoutes } from './tickets.js';

export function createApp(pool, secret, { trustProxy = false } = {}) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '32kb' }));
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ error: 'Database unavailable' });
    }
  });
  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
  }), authRoutes(pool, secret));
  app.use('/api/tickets', authenticate(pool, secret), ticketRoutes(pool));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; ') });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body exceeds 32 KB' });
    if (error.status >= 400 && error.status < 500 && error.expose !== false) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
