import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const statuses = ['open', 'in_progress', 'resolved'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const categories = ['account', 'technical', 'billing', 'other'];
const events = {
  ticket_created: 'created this ticket',
  ticket_updated: 'updated ticket details',
  status_changed: 'changed the status',
  comment_added: 'added a comment',
  ticket_resolved: 'resolved the ticket',
};
const label = value => value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formData = form => Object.fromEntries(new FormData(form));

async function request(path, { token, method = 'GET', body, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api' + path, { method, headers, body: body && JSON.stringify(body), signal });
  if (response.status === 204) return;
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { status: response.status });
  return result;
}

function Select({ title, name, options, value, onChange, placeholder }) {
  const selection = onChange ? { value, onChange } : { defaultValue: value };
  return <label>{title}<select name={name} {...selection}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(option => <option key={option} value={option}>{label(option)}</option>)}
  </select></label>;
}

function Notice({ error }) {
  return error && <p className="error" role="alert">{error}</p>;
}

function Auth({ onSession }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSession(await request('/auth/' + (register ? 'register' : 'login'), {
        method: 'POST', body: formData(event.currentTarget),
      }));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className="auth">
    <section className="panel auth-card">
      <h1>{register ? 'Create your account' : 'Sign in to Relay'}</h1>
      <p className="muted">Submit support requests and follow the conversation in one place.</p>
      <form key={String(register)} onSubmit={submit}>
        {register && <label>Name<input name="name" autoComplete="name" required minLength={2} maxLength={80} /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
          required minLength={register ? 12 : undefined} maxLength={128} />
          {register && <small>Use at least 12 characters.</small>}
        </label>
        <Notice error={error} />
        <button className="primary" disabled={busy}>{register ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="link" type="button" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>
        {register ? 'Already have an account? Sign in' : 'New to Relay? Create an account'}
      </button>
    </section>
  </main>;
}

function TicketForm({ ticket, onSubmit, onCancel, busy }) {
  return <form onSubmit={onSubmit}>
    <label>Title<input name="title" required minLength={3} maxLength={120} defaultValue={ticket?.title} /></label>
    <label>Description<textarea name="description" required maxLength={5000} rows={5} defaultValue={ticket?.description} /></label>
    <div className="form-row">
      <Select title="Category" name="category" options={categories} value={ticket?.category ?? 'technical'} />
      {!ticket && <Select title="Priority" name="priority" options={priorities} value="normal" />}
    </div>
    <div className="actions">
      <button className="primary" disabled={busy}>{ticket ? 'Save changes' : 'Submit ticket'}</button>
      <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  </form>;
}

function Desk({ session, onExpired }) {
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', page: 1 });
  const [list, setList] = useState(null);
  const [view, setView] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [actionError, setActionError] = useState('');
  const { token, user } = session;
  const admin = user.role === 'admin';
  const id = view && view !== 'new' ? view : null;
  const selected = ticket?.id === id ? ticket : null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''));
    request('/tickets?' + params, { token, signal: controller.signal }).then(setList).catch(error => {
      if (controller.signal.aborted) return;
      if (error.status === 401) onExpired();
      else setListError(error.message);
    });
    return () => controller.abort();
  }, [filters, token, revision, onExpired]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    request('/tickets/' + id, { token, signal: controller.signal }).then(setTicket).catch(error => {
      if (controller.signal.aborted) return;
      if (error.status === 401) onExpired();
      else setDetailError(error.message);
    });
    return () => controller.abort();
  }, [id, token, revision, onExpired]);

  function open(next) {
    setEditing(false);
    setDetailError('');
    setActionError('');
    setView(next);
  }

  function filter(key, value) {
    setList(null);
    setListError('');
    setFilters(current => ({ ...current, page: 1, [key]: value }));
  }

  async function mutate(path, method, body, done) {
    setBusy(true);
    setActionError('');
    try {
      const result = await request(path, { token, method, body });
      done?.(result);
      setListError('');
      setDetailError('');
      setRevision(current => current + 1);
    } catch (error) {
      if (error.status === 401) onExpired();
      else setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  const canEdit = selected?.status === 'open' && !admin;
  const canDelete = selected?.status === 'open' && selected?.owner_id === user.id;
  const endpoint = '/tickets/' + id;
  return <main className="shell">
    <div className="heading">
      <div><h1>{admin ? 'Ticket queue' : 'My tickets'}</h1>
        <p className="muted">{admin ? 'Review, prioritize, and resolve support requests.' : 'Create a request or check the progress of an existing ticket.'}</p></div>
      <button type="button" className="primary" disabled={busy} onClick={() => open('new')}>＋ New ticket</button>
    </div>
    <div className={'workspace' + (view ? ' split' : '')}>
      <section className="panel queue" aria-label="Ticket list">
        <div className="filters">
          <label>Search<input type="search" placeholder="Search by title" maxLength={120} value={filters.search}
            onChange={event => filter('search', event.target.value)} /></label>
          <Select title="Status" options={statuses} placeholder="All statuses" value={filters.status}
            onChange={event => filter('status', event.target.value)} />
          <Select title="Priority" options={priorities} placeholder="All priorities" value={filters.priority}
            onChange={event => filter('priority', event.target.value)} />
        </div>
        <Notice error={listError} />
        {!list && !listError && <p role="status" className="empty">Loading tickets…</p>}
        {list?.tickets.length === 0 && <p className="empty">No tickets match this view.</p>}
        {list?.tickets.map(item => <button key={item.id} type="button" className={'ticket-row' + (id === item.id ? ' active' : '')}
          aria-pressed={id === item.id} disabled={busy} onClick={() => open(item.id)}>
          <span><strong>{item.title}</strong><small>{label(item.category)} · {admin && item.owner_name + ' · '}{date(item.updated_at)}</small></span>
          <span className="row-tags"><span className={'badge ' + item.status}>{label(item.status)}</span><small>{label(item.priority)} priority</small></span>
        </button>)}
        {list && (list.page > 1 || list.hasMore) && <div className="pagination">
          <button disabled={list.page === 1} onClick={() => filter('page', list.page - 1)}>Previous</button>
          <span>Page {list.page}</span>
          <button disabled={!list.hasMore} onClick={() => filter('page', list.page + 1)}>Next</button>
        </div>}
      </section>
      {view && <section className="panel detail" aria-label={id ? 'Ticket details' : 'New ticket'}>
        <div className="detail-top">
          <h2>{view === 'new' ? 'New ticket' : selected?.title ?? 'Ticket details'}</h2>
          <button type="button" disabled={busy} onClick={() => open(null)} aria-label="Close ticket panel">×</button>
        </div>
        <Notice error={detailError || actionError} />
        {view === 'new' && <TicketForm key="new" busy={busy} onCancel={() => open(null)} onSubmit={event => {
          event.preventDefault();
          mutate('/tickets', 'POST', formData(event.currentTarget), next => open(next.id));
        }} />}
        {id && !selected && !detailError && <p role="status">Loading ticket…</p>}
        {selected && <React.Fragment key={id}>
          <p className="muted">{label(selected.category)} · {selected.owner_name} · {date(selected.created_at)}</p>
          <div className="actions"><span className={'badge ' + selected.status}>{label(selected.status)}</span>
            <span className="muted">{label(selected.priority)} priority</span></div>
          <p className="body-copy">{selected.description}</p>
          {editing && canEdit && <TicketForm ticket={selected} busy={busy} onCancel={() => setEditing(false)} onSubmit={event => {
            event.preventDefault();
            mutate(endpoint, 'PATCH', formData(event.currentTarget), () => setEditing(false));
          }} />}
          {!editing && (canEdit || canDelete) && <div className="actions">
            {canEdit && <button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit ticket</button>}
            {canDelete && <button type="button" className="danger" disabled={busy} onClick={() => {
              if (window.confirm('Delete this ticket and its conversation?')) mutate(endpoint, 'DELETE', undefined, () => open(null));
            }}>Delete ticket</button>}
          </div>}
          {admin && <form key={selected.status + selected.priority} className="management" onSubmit={event => {
            event.preventDefault();
            mutate(endpoint, 'PATCH', formData(event.currentTarget));
          }}>
            <div className="form-row">
              <Select title="Status" name="status" options={statuses} value={selected.status} />
              <Select title="Priority" name="priority" options={priorities} value={selected.priority} />
            </div>
            <button disabled={busy}>Save status and priority</button>
          </form>}
          <div className="section">
            <h3>Conversation</h3>
            {!selected.comments.length && <p className="muted">No comments yet.</p>}
            {selected.comments.map(entry => <article className="comment" key={entry.id}>
              <strong>{entry.author_name}{entry.author_role === 'admin' && ' · Support'}</strong>
              <small>{date(entry.created_at)}</small>
              <p className="body-copy">{entry.body}</p>
            </article>)}
            <form onSubmit={event => {
              event.preventDefault();
              const form = event.currentTarget;
              mutate(endpoint + '/comments', 'POST', formData(form), () => form.reset());
            }}>
              <label>Comment<textarea name="body" rows={3} required maxLength={2000} /></label>
              <button className="primary" disabled={busy}>Post comment</button>
            </form>
          </div>
          <details className="section">
            <summary>Activity ({selected.activity.length})</summary>
            <ol className="activity">{selected.activity.map(entry => <li key={entry.id}>
              <strong>{entry.actor_name}</strong> {events[entry.event]}
              {entry.details.from && ' from ' + label(entry.details.from) + ' to ' + label(entry.details.to)}
              <small>{date(entry.created_at)}</small>
            </li>)}</ol>
          </details>
        </React.Fragment>}
      </section>}
    </div>
  </main>;
}

function App() {
  // Keep bearer tokens in memory. Reloading the page requires signing in again.
  const [session, setSession] = useState(null);
  const signOut = React.useCallback(() => setSession(null), []);
  return <>
    <header><div className="topbar">
      <div className="brand"><span aria-hidden="true">R</span> Relay <small>Helpdesk</small></div>
      {session && <div className="account"><span>{session.user.name}{session.user.role === 'admin' && ' · Admin'}</span>
        <button onClick={signOut}>Sign out</button></div>}
    </div></header>
    {session ? <Desk session={session} onExpired={signOut} /> : <Auth onSession={setSession} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
