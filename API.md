# Helpdesk REST API

Base URL for local development is `http://localhost:3000/api`. Send JSON with `Content-Type: application/json`. Ticket endpoints require `Authorization: Bearer <token>`.

| Method | Path | Request | Success |
| --- | --- | --- | --- |
| GET | `/health` | — | 200 and `{"status":"ok"}` |
| POST | `/auth/register` | `name`, `email`, `password` | 201 and session |
| POST | `/auth/login` | `email`, `password` | 200 and session |
| GET | `/tickets` | Optional `status`, `priority`, `search`, `page` query parameters | 200 and `{tickets, page, hasMore}` |
| POST | `/tickets` | `title`, `description`, `category`, optional `priority` | 201 and ticket, with a Location header |
| GET | `/tickets/:id` | — | 200 and ticket with comments and activity |
| PATCH | `/tickets/:id` | One or more allowed fields for the caller's role | 200 and ticket |
| DELETE | `/tickets/:id` | — | 204 |
| POST | `/tickets/:id/comments` | `body` | 201 and comment |

A session has shape `{user: {id, name, email, role}, token}`. Ticket records include `id`, `owner_id`, `title`, `description`, `category`, `priority`, `status`, `created_at`, and `updated_at`. List and detail records also include `owner_name`. Detail comments include author ID, name, role, body, and timestamp. Activity records include actor ID and name, event name, event details, and timestamp.

## Validation and permissions

- Passwords for new accounts must contain 12–128 characters. Emails are trimmed and lowercased. Name length is 2–80 characters.
- Ticket titles are 3–120 characters, descriptions are 1–5,000, and comments are 1–2,000 after trimming.
- Categories are `account`, `technical`, `billing`, and `other`.
- Priorities are `low`, `normal` (default), `high`, and `urgent`.
- Statuses are `open` (default), `in_progress`, and `resolved`.
- Users can patch title, description, and category on their own open tickets. Admins can patch status and priority on any ticket. Only an owner can delete an open ticket.
- Lists scope results to the authenticated user unless the caller is an admin. Title search is case-insensitive with literal substring matching. Page numbering starts at 1.

Errors have shape `{"error":"message"}`. The API returns 400 for invalid input, 401 for invalid credentials or tokens, 403 for admin attempts to delete another user's ticket, 404 for missing or inaccessible tickets, 409 for duplicate accounts or edits/deletions blocked by status, 413 for oversized JSON, 429 for authentication throttling, and 503 if the health check cannot reach the database.

## Example flow

```sh
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Taylor","email":"taylor@example.com","password":"a-long-demo-password"}'

# Set TOKEN to the returned user token.
curl -X POST http://localhost:3000/api/tickets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Invoice missing","description":"The April invoice is unavailable.","category":"billing","priority":"high"}'

# Set ID to the returned ticket id and ADMIN_TOKEN to a signed-in admin token.
curl -X PATCH "http://localhost:3000/api/tickets/$ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"resolved"}'
```
