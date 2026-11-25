import { Router } from 'express';
import { z } from 'zod';
import { fail } from './errors.js';
import { transaction } from './db.js';
import { publish } from './events.js';

const priority = z.enum(['low', 'normal', 'high', 'urgent']);
const status = z.enum(['open', 'in_progress', 'resolved']);
const fields = z.strictObject({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(['account', 'technical', 'billing', 'other']),
  priority,
});
const create = fields.extend({ priority: priority.default('normal') });
const userUpdate = fields.omit({ priority: true }).partial();
const adminUpdate = z.strictObject({ status, priority }).partial();
const comment = z.strictObject({ body: z.string().trim().min(1).max(2000) });
const list = z.strictObject({
  status: status.optional(), priority: priority.optional(),
  search: z.string().trim().max(120).default(''),
  page: z.string().regex(/^[1-9]\d{0,5}$/).default('1').transform(Number),
});

async function visibleTicket(client, id, user, lock = false) {
  const { rows: [ticket] } = await client.query(
    'SELECT t.*, u.name AS owner_name FROM tickets t JOIN users u ON u.id = t.owner_id ' +
    'WHERE t.id = $1 AND ($2::boolean OR t.owner_id = $3)' + (lock ? ' FOR UPDATE OF t' : ''),
    [id, user.role === 'admin', user.id],
  );
  if (!ticket) fail(404, 'Ticket not found');
  return ticket;
}

export function ticketRoutes(pool) {
  const router = Router();
  router.param('id', (req, res, next, id) => {
    z.uuid().parse(id);
    next();
  });

  router.get('/', async (req, res) => {
    const { status, priority, search, page } = list.parse(req.query);
    const { rows } = await pool.query(
      'SELECT t.*, u.name AS owner_name FROM tickets t JOIN users u ON u.id = t.owner_id ' +
      'WHERE ($1::boolean OR t.owner_id = $2) AND ($3::text IS NULL OR t.status = $3) ' +
      'AND ($4::text IS NULL OR t.priority = $4) AND strpos(lower(t.title), lower($5)) > 0 ' +
      'ORDER BY t.updated_at DESC, t.id DESC LIMIT 21 OFFSET $6',
      [req.user.role === 'admin', req.user.id, status, priority, search, (page - 1) * 20],
    );
    res.json({ tickets: rows.slice(0, 20), page, hasMore: rows.length > 20 });
  });

  router.post('/', async (req, res) => {
    const { title, description, category, priority } = create.parse(req.body);
    const ticket = await transaction(pool, async client => {
      const { rows: [ticket] } = await client.query(
        'INSERT INTO tickets (owner_id, title, description, category, priority) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.user.id, title, description, category, priority],
      );
      await publish(client, { ticketId: ticket.id, actorId: req.user.id, type: 'ticket_created' });
      return ticket;
    });
    res.location('/api/tickets/' + ticket.id).status(201).json(ticket);
  });

  router.get('/:id', async (req, res) => {
    const result = await transaction(pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const ticket = await visibleTicket(client, req.params.id, req.user);
      const { rows: comments } = await client.query(
        'SELECT c.*, u.name AS author_name, u.role AS author_role FROM comments c JOIN users u ON u.id = c.author_id WHERE ticket_id = $1 ORDER BY created_at, c.id',
        [ticket.id],
      );
      const { rows: activity } = await client.query(
        'SELECT a.*, u.name AS actor_name FROM activity a JOIN users u ON u.id = a.actor_id WHERE ticket_id = $1 ORDER BY a.id',
        [ticket.id],
      );
      return { ...ticket, comments, activity };
    });
    res.json(result);
  });

  router.patch('/:id', async (req, res) => {
    const admin = req.user.role === 'admin';
    const patch = (admin ? adminUpdate : userUpdate).parse(req.body);
    if (!Object.keys(patch).length) fail(400, 'Provide at least one field');
    const result = await transaction(pool, async client => {
      const previous = await visibleTicket(client, req.params.id, req.user, true);
      if (!admin && previous.status !== 'open') fail(409, 'Only open tickets can be edited');
      const changed = Object.keys(patch).filter(key => patch[key] !== previous[key]);
      if (!changed.length) return previous;
      const { rows: [ticket] } = await client.query(
        'UPDATE tickets SET title = $2, description = $3, category = $4, priority = $5, status = $6, updated_at = now() WHERE id = $1 RETURNING *',
        [previous.id, patch.title ?? previous.title, patch.description ?? previous.description,
          patch.category ?? previous.category, patch.priority ?? previous.priority, patch.status ?? previous.status],
      );
      const event = { ticketId: ticket.id, actorId: req.user.id };
      if (changed.some(key => key !== 'status')) {
        await publish(client, { ...event, type: 'ticket_updated', details: { fields: changed.filter(key => key !== 'status') } });
      }
      if (changed.includes('status')) {
        await publish(client, { ...event, type: 'status_changed', details: { from: previous.status, to: ticket.status } });
        if (ticket.status === 'resolved') await publish(client, { ...event, type: 'ticket_resolved' });
      }
      return ticket;
    });
    res.json(result);
  });

  router.delete('/:id', async (req, res) => {
    await transaction(pool, async client => {
      const ticket = await visibleTicket(client, req.params.id, req.user, true);
      if (ticket.owner_id !== req.user.id) fail(403, 'Only the ticket owner can delete it');
      if (ticket.status !== 'open') fail(409, 'Only open tickets can be deleted');
      await client.query('DELETE FROM tickets WHERE id = $1', [ticket.id]);
    });
    res.sendStatus(204);
  });

  router.post('/:id/comments', async (req, res) => {
    const { body } = comment.parse(req.body);
    const result = await transaction(pool, async client => {
      const ticket = await visibleTicket(client, req.params.id, req.user, true);
      const { rows: [entry] } = await client.query(
        'INSERT INTO comments (ticket_id, author_id, body) VALUES ($1, $2, $3) RETURNING *',
        [ticket.id, req.user.id, body],
      );
      await client.query('UPDATE tickets SET updated_at = now() WHERE id = $1', [ticket.id]);
      await publish(client, { ticketId: ticket.id, actorId: req.user.id, type: 'comment_added', details: { commentId: entry.id } });
      return { ...entry, author_name: req.user.name, author_role: req.user.role };
    });
    res.status(201).json(result);
  });
  return router;
}
