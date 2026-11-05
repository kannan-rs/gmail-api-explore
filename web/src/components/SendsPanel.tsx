import { type FormEvent, useEffect, useState } from 'react';
import {
  type ClientRow,
  exportUrl,
  gmailUrlFor,
  listSends,
  type SendFilters,
  type SendListResponse,
  type SendStatus,
  syncTracking,
  verifySend,
} from '../api';
import { errorMessage, formatDateTime, statusLabel } from '../format';
import { SendDetail } from './SendDetail';
import { StatusBadge } from './StatusBadge';
import { TrackingBadges } from './TrackingBadges';

const PAGE_SIZE = 20;

interface SendsPanelProps {
  clients: ClientRow[];
  refreshKey: number;
  onChanged: () => void;
}

interface AppliedFilters {
  clientId: string;
  status: SendStatus | '';
  q: string;
}

export function SendsPanel({ clients, refreshKey, onChanged }: SendsPanelProps) {
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<SendStatus | ''>('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState<AppliedFilters>({ clientId: '', status: '', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SendListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void refreshKey;
    let active = true;
    setLoading(true);
    setError(null);

    const filters: SendFilters = { page, pageSize: PAGE_SIZE };
    if (applied.clientId) {
      filters.clientId = applied.clientId;
    }
    if (applied.status) {
      filters.status = applied.status;
    }
    if (applied.q) {
      filters.q = applied.q;
    }

    listSends(filters)
      .then((response) => {
        if (active) {
          setData(response);
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
  }, [applied, page, refreshKey]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setApplied({ clientId, status, q: q.trim() });
  }

  async function handleVerify(sendId: string) {
    setVerifyingId(sendId);
    setNotice(null);
    try {
      const result = await verifySend(sendId);
      setNotice(
        result.verified
          ? 'Verified in Gmail Sent.'
          : `Not verified: ${result.reason ?? 'Gmail did not confirm the Sent copy.'}`,
      );
      setSelectedId(sendId);
      onChanged();
    } catch (verifyError) {
      setNotice(errorMessage(verifyError));
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await syncTracking(7);
      setNotice(
        `Gmail sync checked ${result.checked} sends: ${result.events} events found, ` +
          `${result.recorded} statuses updated.`,
      );
      onChanged();
    } catch (syncError) {
      setNotice(errorMessage(syncError));
    } finally {
      setSyncing(false);
    }
  }

  function handleExport() {
    const filters: SendFilters = {};
    if (applied.clientId) {
      filters.clientId = applied.clientId;
    }
    if (applied.status) {
      filters.status = applied.status;
    }
    if (applied.q) {
      filters.q = applied.q;
    }
    window.location.href = exportUrl(filters);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="panel" aria-labelledby="sends-title">
      <div className="panel-heading">
        <div>
          <h2 id="sends-title">Sends</h2>
          <p className="muted">Every Gmail send attempt, its Gmail IDs, and its audit state.</p>
          <p className="muted small">
            Bounces arrive as Gmail DSNs after the send; click Sync Gmail to import them. If the
            bounce just occurred, sync again after a minute.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button"
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync Gmail'}
          </button>
          <button className="button" type="button" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      <form className="filters" onSubmit={applyFilters}>
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
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as SendStatus | '')}
          >
            <option value="">All statuses</option>
            <option value="SENDING">Sending</option>
            <option value="SENT">Sent</option>
            <option value="VERIFIED">Verified</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <label className="field field-grow">
          <span>Search</span>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Subject, sender, or recipient"
          />
        </label>
        <button className="button" type="submit">
          Apply
        </button>
      </form>

      {error && <div className="callout error">{error}</div>}
      {notice && <div className="callout info">{notice}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Client</th>
              <th>To</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Tracking</th>
              <th>Gmail</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((send) => {
              const url = gmailUrlFor(send);
              return (
                <tr key={send.id} onClick={() => setSelectedId(send.id)} className="clickable">
                  <td className="nowrap">{formatDateTime(send.createdAt)}</td>
                  <td>{send.clientId}</td>
                  <td className="truncate" title={send.toEmails.join(', ')}>
                    {send.toEmails.join(', ')}
                  </td>
                  <td className="truncate" title={send.subject}>
                    {send.subject}
                    {send.errorCode && <div className="muted small">{send.errorCode}</div>}
                  </td>
                  <td>
                    <StatusBadge status={send.status} />
                  </td>
                  <td>
                    <TrackingBadges send={send} />
                  </td>
                  <td>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Sent
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="button small"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleVerify(send.id);
                      }}
                      disabled={verifyingId === send.id}
                    >
                      {verifyingId === send.id ? 'Checking…' : 'Verify'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No sends match these filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} className="empty">
                  Loading sends…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.pageSize && (
        <div className="pagination">
          <button
            className="button small"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </button>
          <span className="muted small">
            Page {page} of {totalPages} · {data.total} total
          </span>
          <button
            className="button small"
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      )}

      {selectedId && <SendDetail id={selectedId} onClose={() => setSelectedId(null)} />}

      <p className="muted small footnote">
        Ledger statuses: {['SENDING', 'SENT', 'VERIFIED', 'FAILED'].map(statusLabel).join(' · ')}.
        Tracking badges are evidence from pixels, acknowledgement links, Gmail metadata sync, or
        webhooks. Opens are best-effort; delivered status requires a Workspace or ESP feed.
      </p>
    </section>
  );
}
