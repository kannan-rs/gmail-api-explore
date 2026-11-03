import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import type { ClientRow, SendInput, SendResult } from '../api';
import { sendEmail } from '../api';
import { errorMessage, formatBytes, parseEmails } from '../format';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

interface ComposeFormProps {
  clients: ClientRow[];
  connected: boolean;
  onSent: () => void;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function ComposeForm({ clients, connected, onSent }: ComposeFormProps) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyMode, setBodyMode] = useState<'html' | 'text'>('html');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SendResult | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!clientId && clients[0]) {
      setClientId(clients[0].id);
    }
  }, [clients, clientId]);

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) {
      return;
    }

    const next = [...attachments, ...selected];
    if (next.length > MAX_ATTACHMENTS) {
      setError(`At most ${MAX_ATTACHMENTS} attachments are allowed.`);
      return;
    }
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      setError(`Attachments exceed the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit.`);
      return;
    }

    setAttachments(next);
    setError(null);
    setFileInputKey((key) => key + 1);
  }

  function removeFile(index: number) {
    setAttachments((files) => files.filter((_, current) => current !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!connected) {
      setError('Connect Gmail before sending.');
      return;
    }
    if (!clientId) {
      setError('Choose a client.');
      return;
    }

    const recipients = parseEmails(to);
    if (recipients.length === 0) {
      setError('At least one recipient is required.');
      return;
    }
    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }
    if (!body.trim()) {
      setError('A message body is required.');
      return;
    }

    setSending(true);
    try {
      const encodedAttachments = await Promise.all(
        attachments.map(async (file) => ({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64: await readAsBase64(file),
        })),
      );

      const input: SendInput = {
        clientId,
        to: recipients,
        cc: parseEmails(cc),
        bcc: parseEmails(bcc),
        subject: subject.trim(),
        idempotencyKey,
      };
      if (bodyMode === 'html') {
        input.html = body;
      } else {
        input.text = body;
      }
      if (encodedAttachments.length > 0) {
        input.attachments = encodedAttachments;
      }

      const result = await sendEmail(input);
      setSuccess(result);
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setBody('');
      setAttachments([]);
      setFileInputKey((key) => key + 1);
      setIdempotencyKey(crypto.randomUUID());
      onSent();
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setSending(false);
    }
  }

  const attachmentTotal = attachments.reduce((sum, file) => sum + file.size, 0);

  return (
    <section className="panel compose-panel" aria-labelledby="compose-title">
      <div className="panel-heading">
        <div>
          <h2 id="compose-title">Compose</h2>
          <p className="muted">Send through Gmail so the Sent copy is created by Gmail itself.</p>
        </div>
      </div>

      {!connected && (
        <div className="callout warning">Connect a Gmail account before composing a message.</div>
      )}

      <p className="muted small">
        When tracking is enabled, the app adds a tracking ID, acknowledgement link, and hidden pixel
        to the outgoing message. Read receipts require Google Workspace and recipient support.
      </p>

      <form onSubmit={handleSubmit} className="form-grid">
        <label className="field">
          <span>Client</span>
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            disabled={sending}
            required
          >
            {clients.length === 0 && <option value="">No clients yet</option>}
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.id})
              </option>
            ))}
          </select>
        </label>

        <label className="field field-wide">
          <span>To</span>
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="borrower@example.com, ops@example.com"
            disabled={sending}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Cc</span>
          <input
            value={cc}
            onChange={(event) => setCc(event.target.value)}
            placeholder="Optional"
            disabled={sending}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Bcc</span>
          <input
            value={bcc}
            onChange={(event) => setBcc(event.target.value)}
            placeholder="Optional"
            disabled={sending}
            autoComplete="off"
          />
        </label>

        <label className="field field-wide">
          <span>Subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Loan statement — October"
            disabled={sending}
            maxLength={200}
          />
        </label>

        <div className="field field-wide">
          <div className="field-row">
            <span>Body</span>
            <fieldset className="segmented" aria-label="Body format">
              <button
                type="button"
                className={bodyMode === 'html' ? 'active' : ''}
                onClick={() => setBodyMode('html')}
                aria-pressed={bodyMode === 'html'}
              >
                HTML
              </button>
              <button
                type="button"
                className={bodyMode === 'text' ? 'active' : ''}
                onClick={() => setBodyMode('text')}
                aria-pressed={bodyMode === 'text'}
              >
                Plain text
              </button>
            </fieldset>
          </div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            placeholder={
              bodyMode === 'html'
                ? '<p>Hello borrower,</p><p>Your statement is attached.</p>'
                : 'Hello borrower,\n\nYour statement is attached.'
            }
            disabled={sending}
          />
        </div>

        <div className="field field-wide">
          <span>Attachments</span>
          <input
            key={fileInputKey}
            ref={fileInputRef}
            type="file"
            multiple
            onChange={addFiles}
            disabled={sending}
          />
          {attachments.length > 0 && (
            <div className="attachment-list">
              {attachments.map((file, index) => (
                <span className="chip" key={`${file.name}-${file.lastModified}`}>
                  {file.name} · {formatBytes(file.size)}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeFile(index)}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span className="muted small">{formatBytes(attachmentTotal)} total</span>
            </div>
          )}
        </div>

        <div className="form-actions field-wide">
          <button className="button primary" type="submit" disabled={sending || !connected}>
            {sending ? 'Sending…' : 'Send via Gmail'}
          </button>
          <span className="muted small">
            Retry keeps the same idempotency key and Message-ID to avoid duplicates.
          </span>
        </div>
      </form>

      {error && <div className="callout error">{error}</div>}

      {success && (
        <div className="callout success">
          <strong>{success.duplicate ? 'Existing send returned.' : 'Sent and recorded.'}</strong>
          <span>
            Status {success.send.status}
            {success.verified ? ' · verified in Gmail Sent' : ' · awaiting verification'}
          </span>
          {success.gmailUrl && (
            <a href={success.gmailUrl} target="_blank" rel="noreferrer">
              Open in Gmail Sent
            </a>
          )}
          <span className="muted small">Send ID: {success.send.id}</span>
        </div>
      )}
    </section>
  );
}
