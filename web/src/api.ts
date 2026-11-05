export type SendStatus = 'SENDING' | 'SENT' | 'VERIFIED' | 'FAILED';

export interface SendRow {
  id: string;
  provider: string;
  mode: string;
  mailboxId: string | null;
  clientId: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    sha256: string;
  }>;
  messageIdHeader: string;
  trackingId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  providerLabels: string[] | null;
  status: SendStatus;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string;
  requestHash: string;
  sentAt: string | null;
  verifiedAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  bounceType: string | null;
  deferredAt: string | null;
  lastDeferredAt: string | null;
  deferredCount: number;
  openedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  readAt: string | null;
  acknowledgedAt: string | null;
  repliedAt: string | null;
  complainedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SendEvent {
  id: string;
  sendId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type TrackingEventType =
  | 'DELIVERED'
  | 'DEFERRED'
  | 'BOUNCED'
  | 'OPENED'
  | 'READ'
  | 'ACKNOWLEDGED'
  | 'REPLIED'
  | 'COMPLAINED';

export type TrackingSource =
  | 'pixel'
  | 'ack_link'
  | 'gmail_dsn'
  | 'gmail_mdn'
  | 'gmail_thread'
  | 'webhook'
  | 'manual';

export interface TrackingEvent {
  id: string;
  sendId: string;
  trackingId: string;
  eventType: TrackingEventType;
  source: TrackingSource;
  providerEventId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TrackingLinks {
  openUrl: string | null;
  acknowledgeUrl: string | null;
}

export interface TrackingSyncResult {
  checked: number;
  events: number;
  recorded: number;
  duplicates: number;
  errors: number;
}

export interface SendListResponse {
  items: SendRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SendResult {
  send: SendRow;
  duplicate: boolean;
  verified: boolean;
  gmailUrl: string | null;
}

export interface SendDetailResponse {
  send: SendRow;
  events: SendEvent[];
  trackingEvents: TrackingEvent[];
  trackingLinks: TrackingLinks | null;
  gmailUrl: string | null;
}

export interface VerifyResponse {
  send: SendRow;
  verified: boolean;
  labels: string[];
  reason: string | null;
  gmailUrl: string | null;
}

export interface MailboxInfo {
  id: string;
  email: string;
  displayName: string | null;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeResponse {
  configured: boolean;
  connected: boolean;
  autoConnect: boolean;
  mailbox: MailboxInfo | null;
}

export interface HealthResponse {
  status: string;
  database: string;
  gmail: string;
  mailbox: string | null;
  time: string;
}

export interface Summary {
  total: number;
  sent: number;
  verified: number;
  failed: number;
  inFlight: number;
  delivered: number;
  bounced: number;
  hardBounced: number;
  softBounced: number;
  deferred: number;
  opened: number;
  read: number;
  acknowledged: number;
  replied: number;
}

export interface DailyCount {
  date: string;
  sent: number;
  failed: number;
  total: number;
}

export interface ClientCount {
  clientId: string;
  sent: number;
  failed: number;
  total: number;
}

export interface ClientRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface ReconcileResult {
  checked: number;
  verified: number;
  stillUnverified: number;
  errors: number;
  recovered: number;
}

export interface SendFilters {
  clientId?: string;
  status?: SendStatus | '';
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface SendInput {
  clientId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    contentBase64: string;
  }>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, code = 'REQUEST_FAILED', details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      error?.message ?? `Request failed with status ${response.status}`,
      error?.code ?? 'REQUEST_FAILED',
      error?.details ?? null,
    );
  }

  return body as T;
}

function queryString(filters: SendFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.clientId) {
    params.set('clientId', filters.clientId);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.page) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize) {
    params.set('pageSize', String(filters.pageSize));
  }
  const value = params.toString();
  return value.length > 0 ? `?${value}` : '';
}

export function getMe(): Promise<MeResponse> {
  return request('/api/auth/me');
}

export function getHealth(): Promise<HealthResponse> {
  return request('/api/health');
}

export function disconnectGmail(): Promise<{ connected: boolean }> {
  return request('/api/auth/disconnect', { method: 'POST' });
}

export function sendEmail(input: SendInput): Promise<SendResult> {
  return request('/api/sends', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listSends(filters: SendFilters = {}): Promise<SendListResponse> {
  return request(`/api/sends${queryString(filters)}`);
}

export function getSend(id: string): Promise<SendDetailResponse> {
  return request(`/api/sends/${encodeURIComponent(id)}`);
}

export function verifySend(id: string): Promise<VerifyResponse> {
  return request(`/api/sends/${encodeURIComponent(id)}/verify`, { method: 'POST' });
}

export function reconcileSends(days = 2): Promise<ReconcileResult> {
  return request('/api/sends/reconcile', {
    method: 'POST',
    body: JSON.stringify({ days }),
  });
}

export function syncTracking(days = 7): Promise<TrackingSyncResult> {
  return request('/api/tracking/sync', {
    method: 'POST',
    body: JSON.stringify({ days }),
  });
}

export function getSummary(filters: SendFilters = {}): Promise<Summary> {
  return request(`/api/stats/summary${queryString(filters)}`);
}

export function getDaily(days = 14, clientId = ''): Promise<{ items: DailyCount[] }> {
  const params = new URLSearchParams({ days: String(days) });
  if (clientId) {
    params.set('clientId', clientId);
  }
  return request(`/api/stats/daily?${params.toString()}`);
}

export function getByClient(filters: SendFilters = {}): Promise<{ items: ClientCount[] }> {
  return request(`/api/stats/by-client${queryString(filters)}`);
}

export function listClients(): Promise<{ items: ClientRow[] }> {
  return request('/api/clients');
}

export function createClient(input: { id: string; name: string }): Promise<ClientRow> {
  return request('/api/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function exportUrl(filters: SendFilters = {}): string {
  return `/api/sends/export${queryString(filters)}`;
}

export function gmailUrlFor(send: Pick<SendRow, 'fromEmail' | 'providerMessageId'>): string | null {
  if (!send.providerMessageId) {
    return null;
  }
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(
    send.fromEmail,
  )}#sent/${encodeURIComponent(send.providerMessageId)}`;
}
