import { useEffect, useState } from 'react';
import {
  type ClientRow,
  disconnectGmail,
  getHealth,
  getMe,
  type HealthResponse,
  listClients,
  type MeResponse,
} from './api';
import { ComposeForm } from './components/ComposeForm';
import { Dashboard } from './components/Dashboard';
import { SendsPanel } from './components/SendsPanel';
import { errorMessage } from './format';

type Tab = 'compose' | 'sends' | 'dashboard';

interface Notice {
  kind: 'success' | 'error' | 'info';
  message: string;
}

export function App() {
  const [tab, setTab] = useState<Tab>('compose');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  function refresh() {
    setRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    void refreshKey;
    let active = true;
    setLoading(true);
    Promise.all([getMe(), getHealth(), listClients()])
      .then(([meResponse, healthResponse, clientsResponse]) => {
        if (active) {
          setMe(meResponse);
          setHealth(healthResponse);
          setClients(clientsResponse.items);
        }
      })
      .catch((requestError) => {
        if (active) {
          setNotice({ kind: 'error', message: errorMessage(requestError) });
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
  }, [refreshKey]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get('connected');
    const oauthError = url.searchParams.get('oauth_error');

    if (connected) {
      setNotice({ kind: 'success', message: `Connected ${connected} to Gmail.` });
      setTab('compose');
    }
    if (oauthError) {
      setNotice({ kind: 'error', message: oauthError });
    }

    if (connected || oauthError) {
      url.searchParams.delete('connected');
      url.searchParams.delete('oauth_error');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setNotice(null);
    try {
      await disconnectGmail();
      setNotice({ kind: 'info', message: 'Gmail disconnected.' });
      refresh();
    } catch (disconnectError) {
      setNotice({ kind: 'error', message: errorMessage(disconnectError) });
    } finally {
      setDisconnecting(false);
    }
  }

  const connected = me?.connected ?? false;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Audit ledger</p>
          <h1>Gmail Send Tracker</h1>
          <p className="muted">
            Gmail does the sending, the Sent folder is the evidence, and Postgres records the trail.
          </p>
        </div>

        <div className="header-status">
          <div className="connection">
            <span className={`dot ${health?.database === 'ok' ? 'online' : 'offline'}`} />
            <span>{health?.database === 'ok' ? 'Database online' : 'Database unavailable'}</span>
          </div>
          <div className="connection">
            <span className={`dot ${connected ? 'online' : 'offline'}`} />
            <span>{connected ? me?.mailbox?.email : 'No Gmail connected'}</span>
          </div>

          {connected ? (
            <button
              className="button"
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : me?.configured ? (
            <a className="button primary" href="/api/auth/google">
              Connect Gmail
            </a>
          ) : (
            <span className="muted small">Set Google OAuth credentials to connect.</span>
          )}
        </div>
      </header>

      {notice && (
        <div className={`callout ${notice.kind}`}>
          <span>{notice.message}</span>
          <button className="icon-button" type="button" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        <button
          type="button"
          className={tab === 'compose' ? 'active' : ''}
          onClick={() => setTab('compose')}
        >
          Compose
        </button>
        <button
          type="button"
          className={tab === 'sends' ? 'active' : ''}
          onClick={() => setTab('sends')}
        >
          Sends
        </button>
        <button
          type="button"
          className={tab === 'dashboard' ? 'active' : ''}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
      </nav>

      <main>
        {loading && !me && <p className="muted">Loading…</p>}

        {tab === 'compose' && (
          <ComposeForm clients={clients} connected={connected} onSent={refresh} />
        )}
        {tab === 'sends' && (
          <SendsPanel clients={clients} refreshKey={refreshKey} onChanged={refresh} />
        )}
        {tab === 'dashboard' && (
          <Dashboard clients={clients} refreshKey={refreshKey} onChanged={refresh} />
        )}
      </main>

      <footer className="app-footer">
        <span>
          Sent copy proves Gmail accepted the message. It is not proof of recipient delivery.
        </span>
        <span>
          Local V1 · {health?.gmail === 'configured' ? 'Gmail configured' : 'Gmail setup needed'}
        </span>
      </footer>
    </div>
  );
}
