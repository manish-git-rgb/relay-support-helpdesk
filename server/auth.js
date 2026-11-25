import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { fail } from './errors.js';

const derive = promisify(scrypt);
const email = z.string().trim().toLowerCase().email().max(254);
const login = z.strictObject({ email, password: z.string().min(1).max(128) });
const register = login.extend({ name: z.string().trim().min(2).max(80), password: z.string().min(12).max(128) });
const tokenOptions = { issuer: 'support-helpdesk', audience: 'helpdesk-api' };
const dummyHash = randomBytes(64);

export function authRoutes(pool, secret) {
  const router = Router();
  function session(res, user, status = 200) {
    const token = jwt.sign({}, secret, {
      ...tokenOptions, algorithm: 'HS256', subject: user.id, expiresIn: '1h',
    });
    res.status(status).json({ user, token });
  }

  router.post('/register', async (req, res) => {
    const { name, email, password } = register.parse(req.body);
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt, 64);
    const { rows: [user] } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, name, email, role',
      [name, email, salt + ':' + hash.toString('hex')],
    );
    if (!user) fail(409, 'An account already exists for this email');
    session(res, user, 201);
  });

  router.post('/login', async (req, res) => {
    const { email, password } = login.parse(req.body);
    const { rows: [record] } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const [salt, hash] = record?.password_hash.split(':') ?? ['unregistered-account'];
    const candidate = await derive(password, salt, 64);
    if (!timingSafeEqual(candidate, hash ? Buffer.from(hash, 'hex') : dummyHash) || !record) {
      fail(401, 'Incorrect email or password');
    }
    const { id, name, role } = record;
    session(res, { id, name, email, role });
  });
  return router;
}

export function authenticate(pool, secret) {
  return async (req, res, next) => {
    const token = req.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    let claims;
    try {
      claims = jwt.verify(token, secret, { ...tokenOptions, algorithms: ['HS256'] });
    } catch {
      fail(401, 'Sign in to continue');
    }
    const id = z.uuid().safeParse(claims.sub);
    if (!id.success) fail(401, 'Sign in to continue');
    const { rows: [user] } = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [id.data]);
    if (!user) fail(401, 'Sign in to continue');
    req.user = user;
    next();
  };
}
