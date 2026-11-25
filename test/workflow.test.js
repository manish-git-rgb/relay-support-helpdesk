import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';

test('requester and administrator ticket workflow', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const pool = {
    query: db.query.bind(db),
    connect: async () => ({ query: db.query.bind(db), release() {} }),
  };
  const server = createApp(pool, 'test-only-key-with-more-than-thirty-two-bytes').listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');

  async function call(status, path, { token, method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
      headers, method, body: body && JSON.stringify(body),
    });
    const data = response.status === 204 ? undefined : await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }

  const password = 'very-long-test-password';
  async function register(name) {
    return call(201, '/auth/register', {
      method: 'POST', body: { name, email: name + '@example.com', password },
    });
  }
  const owner = await register('Owner');
  const outsider = await register('Outsider');
  const admin = await register('Support');
  assert.equal(admin.user.role, 'user');
  assert.equal(owner.user.password_hash, undefined);
  await call(400, '/auth/register', {
    method: 'POST', body: { name: 'Injected', email: 'bad@example.com', password, role: 'admin' },
  });
  await call(409, '/auth/register', {
    method: 'POST', body: { name: 'Owner', email: 'OWNER@example.com', password },
  });
  await call(401, '/auth/login', { method: 'POST', body: { email: admin.user.email, password: 'incorrect' } });
  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  const support = await call(200, '/auth/login', { method: 'POST', body: { email: admin.user.email, password } });
  assert.equal(support.user.role, 'admin');

  const body = { title: 'Missing invoice', description: 'The last invoice is missing.', category: 'billing' };
  await call(401, '/tickets');
  const ticket = await call(201, '/tickets', { token: owner.token, method: 'POST', body });
  const path = '/tickets/' + ticket.id;
  assert.equal(ticket.status, 'open');
  assert.equal((await call(200, '/tickets', { token: outsider.token })).tickets.length, 0);
  await call(404, path, { token: outsider.token });
  await call(404, path + '/comments', { token: outsider.token, method: 'POST', body: { body: 'Private' } });
  await call(400, path, { token: owner.token, method: 'PATCH', body: { status: 'resolved' } });
  await call(200, path, { token: owner.token, method: 'PATCH', body: { title: 'April invoice' } });
  await call(201, path + '/comments', { token: owner.token, method: 'POST', body: { body: 'It is for April.' } });
  await call(403, path, { token: support.token, method: 'DELETE' });
  await call(201, path + '/comments', { token: support.token, method: 'POST', body: { body: 'Invoice restored.' } });
  await call(200, path, { token: support.token, method: 'PATCH', body: { status: 'resolved', priority: 'high' } });
  await call(200, path, { token: support.token, method: 'PATCH', body: { status: 'resolved' } });
  await call(409, path, { token: owner.token, method: 'PATCH', body: { title: 'Too late' } });
  await call(409, path, { token: owner.token, method: 'DELETE' });

  const matches = await call(200, '/tickets?status=resolved&priority=high&search=APRIL&page=1', { token: support.token });
  assert.equal(matches.tickets[0].id, ticket.id);
  const detail = await call(200, path, { token: owner.token });
  assert.deepEqual(detail.comments.map(entry => entry.author_role), ['user', 'admin']);
  assert.deepEqual(detail.activity.map(entry => entry.event), [
    'ticket_created', 'ticket_updated', 'comment_added', 'comment_added', 'ticket_updated', 'status_changed', 'ticket_resolved',
  ]);

  const removable = await call(201, '/tickets', { token: owner.token, method: 'POST', body });
  const removablePath = '/tickets/' + removable.id;
  await call(201, removablePath + '/comments', { token: owner.token, method: 'POST', body: { body: 'Extra context' } });
  await call(204, removablePath, { token: owner.token, method: 'DELETE' });
  await call(404, removablePath, { token: owner.token });
  assert.equal((await db.query('SELECT id FROM activity WHERE ticket_id = $1', [removable.id])).rows.length, 0);
  assert.equal((await db.query('SELECT id FROM comments WHERE ticket_id = $1', [removable.id])).rows.length, 0);
});
