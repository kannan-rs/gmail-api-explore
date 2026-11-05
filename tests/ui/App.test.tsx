// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../web/src/App';

const mailbox = {
  id: 'mailbox-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  provider: 'gmail',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sendRow = {
  id: 'send-1',
  provider: 'gmail',
  mode: 'direct',
  mailboxId: 'mailbox-1',
  clientId: 'client-01',
  fromEmail: 'owner@example.com',
  toEmails: ['borrower@example.com'],
  ccEmails: [],
  bccEmails: [],
  subject: 'Loan statement',
  bodyHtml: '<p>Body</p>',
  bodyText: null,
  attachments: [],
  messageIdHeader: '<message-1@example.com>',
  providerMessageId: 'gmail-1',
  providerThreadId: 'thread-1',
  providerLabels: ['SENT'],
  status: 'VERIFIED',
  errorCode: null,
  errorMessage: null,
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  requestHash: 'hash',
  sentAt: '2026-01-02T00:00:00.000Z',
  verifiedAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(options: {
  connected: boolean;
  configured?: boolean;
  autoConnect?: boolean;
  sendResult?: unknown;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/api/auth/me')) {
      return json({
        configured: options.configured ?? true,
        connected: options.connected,
        autoConnect: options.autoConnect ?? false,
        mailbox: options.connected ? mailbox : null,
      });
    }
    if (url.endsWith('/api/health')) {
      return json({
        status: 'ok',
        database: 'ok',
        gmail: options.configured === false ? 'not_configured' : 'configured',
        mailbox: options.connected ? mailbox.email : null,
        time: '2026-01-01T00:00:00.000Z',
      });
    }
    if (url.endsWith('/api/clients')) {
      return json({
        items: [{ id: 'client-01', name: 'Client 01', createdAt: '2026-01-01T00:00:00.000Z' }],
      });
    }
    if (url.includes('/api/sends') && url.includes('export')) {
      return new Response('id,status\r\nsend-1,VERIFIED\r\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    if (url.includes('/api/sends') && init?.method === 'POST') {
      return json(
        options.sendResult ?? {
          send: sendRow,
          duplicate: false,
          verified: true,
          gmailUrl: 'https://mail.google.com/mail/?authuser=owner%40example.com#sent/gmail-1',
        },
        201,
      );
    }
    if (url.includes('/api/sends?')) {
      return json({ items: [sendRow], total: 1, page: 1, pageSize: 20 });
    }
    if (url.endsWith('/api/sends')) {
      return json({ items: [sendRow], total: 1, page: 1, pageSize: 20 });
    }
    if (url.includes('/api/stats/summary')) {
      return json({ total: 1, sent: 1, verified: 1, failed: 0, inFlight: 0 });
    }
    if (url.includes('/api/stats/daily')) {
      return json({ items: [{ date: '2026-01-02', sent: 1, failed: 0, total: 1 }] });
    }
    if (url.includes('/api/stats/by-client')) {
      return json({ items: [{ clientId: 'client-01', sent: 1, failed: 0, total: 1 }] });
    }
    if (url.endsWith('/api/sends/send-1')) {
      return json({ send: sendRow, events: [], gmailUrl: null });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
    });
  }
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the connected mailbox and lets the user compose and send', async () => {
    mockFetch({ connected: true });
    render(<App />);

    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    const sendButton = await screen.findByRole('button', { name: 'Send via Gmail' });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: 'borrower@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Loan statement' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Hello borrower/i), {
      target: { value: '<p>Statement attached</p>' },
    });
    fireEvent.click(sendButton);

    expect(await screen.findByText('Sent and recorded.')).toBeTruthy();
    const gmailLinks = await screen.findAllByRole('link', { name: 'Open in Gmail Sent' });
    expect(gmailLinks[0]?.getAttribute('href')).toContain('#sent/gmail-1');
  });

  it('validates required fields before calling the API', async () => {
    mockFetch({ connected: true });
    render(<App />);

    await screen.findByRole('option', { name: /Client 01/ });
    fireEvent.click(await screen.findByRole('button', { name: 'Send via Gmail' }));

    expect(await screen.findByText('At least one recipient is required.')).toBeTruthy();
  });

  it('shows the auto-connected mailbox without a Connect or Disconnect button', async () => {
    mockFetch({ connected: true, autoConnect: true });
    render(<App />);

    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('Auto-connected from GOOGLE_REFRESH_TOKEN')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Connect Gmail' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('shows the connect prompt when Gmail is not connected', async () => {
    mockFetch({ connected: false, configured: true });
    render(<App />);

    expect(await screen.findByRole('link', { name: 'Connect Gmail' })).toBeTruthy();
    expect(screen.getByText('Connect a Gmail account before composing a message.')).toBeTruthy();
  });

  it('shows an OAuth error from the callback URL', async () => {
    mockFetch({ connected: false, configured: true });
    window.history.replaceState({}, '', '/?oauth_error=Google%20connection%20was%20cancelled');

    render(<App />);

    expect(await screen.findByText('Google connection was cancelled')).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('loads the sends table', async () => {
    mockFetch({ connected: true });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sends' }));

    expect(await screen.findByText('Loan statement')).toBeTruthy();
    expect(screen.getByText('Verified', { selector: '.badge' })).toBeTruthy();
  });
});
