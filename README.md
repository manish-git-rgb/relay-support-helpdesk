# Relay Helpdesk

A mini support desk built with Node.js, Express, PostgreSQL, and React. Requesters submit tickets and follow their status. Administrators work from a shared queue, set priority, change status, and reply.

## Local setup

Use Node.js 22.12+ and PostgreSQL 16+. From this directory:

```sh
npm ci
docker run --name relay-postgres -e POSTGRES_USER=helpdesk -e POSTGRES_PASSWORD=helpdesk -e POSTGRES_DB=helpdesk -p 127.0.0.1:5432:5432 -d postgres:16
```

The Docker command is optional if you already have PostgreSQL. Copy `.env.example` to `.env`, set the connection string for your database, and populate `JWT_SECRET` with the output of:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save the generated secret in `.env`, then build and start the app.

```sh
npm run build
npm start
```

Open http://localhost:3000. For frontend development, keep the API running and use `npm run dev` in another terminal. Vite proxies API calls to port 3000.

Register an account through the app. To grant administrator access, run `npm run admin -- admin@example.com` with that account's email against the same database, then sign in again. Registration always creates a user account.

## Access rules

| Action | User | Admin |
| --- | --- | --- |
| Create tickets | Yes | Yes |
| List and read tickets | Own | All |
| Edit title, description, category | Own open tickets | — |
| Delete tickets | Own open tickets | Own open tickets |
| Set status or priority | — | All |
| Comment | Own | All |

Tickets start open and may move between open, in progress, and resolved. Users can continue the conversation after resolution. Queue results are ordered by recent activity, with title search, status and priority filters, and pages of 20.

## Architecture and database

The Express application separates authentication, ticket handlers, the activity handler, and database setup. Zod validates API inputs. All user-supplied SQL values are parameters. Passwords are salted and hashed with scrypt. The API issues one-hour HS256 JWTs and reads the current role from PostgreSQL for each protected request. React keeps the token in memory, so reloading the page requires signing in again. Authentication is rate-limited per process.

The [SQL schema](server/schema.sql) defines four related tables.

| Table | Purpose |
| --- | --- |
| `users` | Unique normalized email, password hash, name, and role |
| `tickets` | One owner per ticket, with category, priority, status, and timestamps |
| `comments` | One ticket and one author per comment |
| `activity` | One ticket and one actor per event, with JSON metadata and a timestamp |

Foreign keys enforce those relationships. Deleting an open ticket removes its comments and activity through cascading foreign keys. Indexes support the owner queue, recent ticket order, and ticket-scoped conversation and activity reads. Startup initializes the schema under a PostgreSQL advisory lock.

Ticket commands publish `ticket_created`, `ticket_updated`, `status_changed`, `comment_added`, and `ticket_resolved` events. The activity handler writes each event inside the same transaction as the change. Ticket updates, deletes, and comments lock the ticket row while checking and changing state. A no-op update creates no event. Resolving a ticket records both the status transition and the resolution.

See [API documentation](API.md) for request examples, response shapes, and error codes.

## Verification

`npm test` runs an HTTP integration test against disposable embedded PostgreSQL using PGlite. It covers registration, login, ownership, editing, administrator updates, comments, resolution events, and deletion. `npm run build` checks the production frontend build.

## Deployment

Push this directory as the root of a standalone GitHub repository. In Render, create a Blueprint from that repository using the included `render.yaml`. It provisions a Node web service and PostgreSQL and generates the JWT signing secret. The API serves the built React app on the same origin. Check `/api/health` and open the service URL to exercise registration, then promote a registered account with the admin command using a trusted connection to the deployed database. The Blueprint restricts external database connections by default. [Render Blueprint documentation](https://render.com/docs/blueprint-spec)

Submission links are pending GitHub publication and a successful deployment.
