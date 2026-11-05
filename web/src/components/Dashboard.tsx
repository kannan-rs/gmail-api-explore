import { useEffect, useState } from 'react';
import {
  type ClientCount,
  type ClientRow,
  type DailyCount,
  getByClient,
  getDaily,
  getSummary,
  reconcileSends,
  type SendFilters,
  type Summary,
  syncTracking,
} from '../api';
import { errorMessage, formatDay } from '../format';

interface DashboardProps {
  clients: ClientRow[];
  refreshKey: number;
  onChanged: () => void;
}

export function Dashboard({ clients, refreshKey, onChanged }: DashboardProps) {
  const [clientId, setClientId] = useState('');
  const [days, setDays] = useState(14);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyCount[]>([]);
  const [byClient, setByClient] = useState<ClientCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void refreshKey;
    let active = true;
    setLoading(true);
    setError(null);

    const filters: SendFilters = {};
    if (clientId) {
      filters.clientId = clientId;
    }

    Promise.all([getSummary(filters), getDaily(days, clientId), getByClient(filters)])
      .then(([summaryResponse, dailyResponse, byClientResponse]) => {
        if (active) {
          setSummary(summaryResponse);
          setDaily(dailyResponse.items);
          setByClient(byClientResponse.items);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(errorMessage(requestError));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [clientId, days, refreshKey]);

  async function handleReconcile() {
    setReconciling(true);
    setNotice(null);
    try {
      const result = await reconcileSends(2);
      setNotice(
        `Reconciled ${result.checked} recent sends: ${result.verified} verified, ` +
          `${result.stillUnverified} unverified, ${result.recovered} recovered, ` +
          `${result.errors} errors.`,
      );
      onChanged();
    } catch (reconcileError) {
      setNotice(errorMessage(reconcileError));
    } finally {
      setReconciling(false);
    }
  }

  async function handleTrackingSync() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await syncTracking(7);
      setNotice(
        `Tracking sync checked ${result.checked} sends: ${result.events} events found, ` +
          `${result.recorded} statuses updated.`,
      );
      onChanged();
    } catch (syncError) {
      setNotice(errorMessage(syncError));
    } finally {
      setSyncing(false);
    }
  }

  const maxDaily = Math.max(1, ...daily.map((item) => item.total));

  return (
    <section className="panel" aria-labelledby="dashboard-title">
      <div className="panel-heading">
        <div>
          <h2 id="dashboard-title">Dashboard</h2>
          <p className="muted">Counts are derived from the send ledger, not a separate counter.</p>
          <p className="muted small">
            Bounce counts update after Sync tracking imports the Gmail DSN from the inbox.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button"
            type="button"
            onClick={() => void handleTrackingSync()}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync tracking'}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void handleReconcile()}
            disabled={reconciling}
          >
            {reconciling ? 'Reconciling…' : 'Reconcile Gmail'}
          </button>
        </div>
      </div>

      <div className="filters">
        <label className="field">
          <span>Client</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Window</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {error && <div className="callout error">{error}</div>}
      {notice && <div className="callout info">{notice}</div>}

      <div className="stat-grid">
        <article className="stat">
          <span>Total</span>
          <strong>{summary?.total ?? '—'}</strong>
        </article>
        <article className="stat">
          <span>Sent</span>
          <strong>{summary?.sent ?? '—'}</strong>
          <small>SENT + VERIFIED</small>
        </article>
        <article className="stat">
          <span>Verified</span>
          <strong>{summary?.verified ?? '—'}</strong>
          <small>Gmail Sent confirmed</small>
        </article>
        <article className="stat">
          <span>Failed</span>
          <strong>{summary?.failed ?? '—'}</strong>
          <small>No false Sent state</small>
        </article>
        <article className="stat">
          <span>In flight</span>
          <strong>{summary?.inFlight ?? '—'}</strong>
          <small>SENDING</small>
        </article>
      </div>

      <div className="stat-grid tracking-stats">
        <article className="stat">
          <span>Delivered</span>
          <strong>{summary?.delivered ?? '—'}</strong>
          <small>Workspace/ESP evidence</small>
        </article>
        <article className="stat">
          <span>Bounced</span>
          <strong>{summary?.bounced ?? '—'}</strong>
          <small>Hard + soft</small>
        </article>
        <article className="stat">
          <span>Hard bounces</span>
          <strong>{summary?.hardBounced ?? '—'}</strong>
          <small>Permanent failures</small>
        </article>
        <article className="stat">
          <span>Soft bounces</span>
          <strong>{summary?.softBounced ?? '—'}</strong>
          <small>Transient failures</small>
        </article>
        <article className="stat">
          <span>Deferred</span>
          <strong>{summary?.deferred ?? '—'}</strong>
          <small>Still retrying</small>
        </article>
        <article className="stat">
          <span>Opened</span>
          <strong>{summary?.opened ?? '—'}</strong>
          <small>Best-effort pixel</small>
        </article>
        <article className="stat">
          <span>Read</span>
          <strong>{summary?.read ?? '—'}</strong>
          <small>Receipt or webhook</small>
        </article>
        <article className="stat">
          <span>Acknowledged</span>
          <strong>{summary?.acknowledged ?? '—'}</strong>
          <small>Link click</small>
        </article>
        <article className="stat">
          <span>Replied</span>
          <strong>{summary?.replied ?? '—'}</strong>
          <small>Gmail thread match</small>
        </article>
      </div>

      <div className="dashboard-grid">
        <div className="subpanel">
          <h3>Daily volume</h3>
          {daily.length === 0 ? (
            <p className="muted">No sends in this window.</p>
          ) : (
            <div className="bar-list">
              {daily.map((item) => (
                <div className="bar-row" key={item.date}>
                  <span className="bar-label">{formatDay(item.date)}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill sent"
                      style={{ width: `${(item.sent / maxDaily) * 100}%` }}
                      title={`${item.sent} sent`}
                    />
                    <div
                      className="bar-fill failed"
                      style={{ width: `${(item.failed / maxDaily) * 100}%` }}
                      title={`${item.failed} failed`}
                    />
                  </div>
                  <span className="bar-value">
                    {item.sent} / {item.failed}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">sent / failed</p>
        </div>

        <div className="subpanel">
          <h3>By client</h3>
          {byClient.length === 0 ? (
            <p className="muted">No client activity yet.</p>
          ) : (
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {byClient.map((item) => (
                  <tr key={item.clientId}>
                    <td>{item.clientId}</td>
                    <td>{item.sent}</td>
                    <td>{item.failed}</td>
                    <td>{item.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {loading && <p className="muted small">Refreshing…</p>}
    </section>
  );
}
