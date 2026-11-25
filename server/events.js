export async function publish(client, { ticketId, actorId, type, details = {} }) {
  // Await the activity handler inside the transaction so it commits with the change.
  await client.query('INSERT INTO activity (ticket_id, actor_id, event, details) VALUES ($1, $2, $3, $4)',
    [ticketId, actorId, type, JSON.stringify(details)]);
}
