import { useEffect, useState } from 'react';
import { getSend, gmailUrlFor, type SendDetailResponse } from '../api';
import {
  errorMessage,
  formatBytes,
  formatDateTime,
  trackingEventLabel,
  trackingSourceLabel,
} from '../format';
import { StatusBadge } from './StatusBadge';
import { TrackingBadges } from './TrackingBadges';

interface SendDetailProps {
  id: string;
  onClose: () => void;
}

export function SendDetail({ id, onClose }: SendDetailProps) {
  const [detail, setDetail] = useState<SendDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    getSend(id)
      .then((response) => {
        if (active) {
          setDetail(response);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(errorMessage(requestError));
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="send-detail-title">
        <div className="modal-header">
          <h2 id="send-detail-title">Send detail</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="callout error">{error}</div>}
        {!detail && !error && <p className="muted">Loading…</p>}

        {detail && (
          <div className="detail-body">
            <div className="detail-title-row">
              <div>
                <h3>{detail.send.subject}</h3>
                <p className="muted small">
                  {detail.send.fromEmail} → {detail.send.toEmails.join(', ')}
                </p>
              </div>
              <div className="badge-row">
                <StatusBadge status={detail.send.status} />
                <TrackingBadges send={detail.send} />
              </div>
            </div>

            <div className="meta-grid">
              <div>
                <span>Created</span>
                <strong>{formatDateTime(detail.send.createdAt)}</strong>
              </div>
              <div>
                <span>Sent</span>
                <strong>{formatDateTime(detail.send.sentAt)}</strong>
              </div>
              <div>
                <span>Verified</span>
                <strong>{formatDateTime(detail.send.verifiedAt)}</strong>
              </div>
              <div>
                <span>Client</span>
                <strong>{detail.send.clientId}</strong>
              </div>
              <div className="meta-wide">
                <span>Message-ID</span>
                <code>{detail.send.messageIdHeader}</code>
              </div>
              <div className="meta-wide">
                <span>Tracking ID</span>
                <code>{detail.send.trackingId}</code>
              </div>
              <div className="meta-wide">
                <span>Gmail message ID</span>
                <code>{detail.send.providerMessageId ?? '—'}</code>
              </div>
              <div className="meta-wide">
                <span>Labels</span>
                <code>{detail.send.providerLabels?.join(', ') || '—'}</code>
              </div>
              {detail.send.errorCode && (
                <div className="meta-wide">
                  <span>Error</span>
                  <strong>
                    {detail.send.errorCode}: {detail.send.errorMessage}
                  </strong>
                </div>
              )}
            </div>

            {detail.send.attachments.length > 0 && (
              <div>
                <h4>Attachments</h4>
                <ul className="plain-list">
                  {detail.send.attachments.map((attachment) => (
                    <li key={`${attachment.filename}-${attachment.sha256}`}>
                      {attachment.filename} · {attachment.mimeType} · {formatBytes(attachment.size)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4>Tracking</h4>
              <div className="meta-grid">
                <div>
                  <span>Delivered</span>
                  <strong>{formatDateTime(detail.send.deliveredAt)}</strong>
                </div>
                <div>
                  <span>Bounced</span>
                  <strong>
                    {formatDateTime(detail.send.bouncedAt)}
                    {detail.send.bounceType ? ` (${detail.send.bounceType})` : ''}
                  </strong>
                </div>
                <div>
                  <span>First deferred</span>
                  <strong>{formatDateTime(detail.send.deferredAt)}</strong>
                </div>
                <div>
                  <span>Last deferred</span>
                  <strong>{formatDateTime(detail.send.lastDeferredAt)}</strong>
                </div>
                <div>
                  <span>Deferral count</span>
                  <strong>{detail.send.deferredCount}</strong>
                </div>
                <div>
                  <span>First open</span>
                  <strong>{formatDateTime(detail.send.openedAt)}</strong>
                </div>
                <div>
                  <span>Last open</span>
                  <strong>{formatDateTime(detail.send.lastOpenedAt)}</strong>
                </div>
                <div>
                  <span>Open count</span>
                  <strong>{detail.send.openCount}</strong>
                </div>
                <div>
                  <span>Read receipt</span>
                  <strong>{formatDateTime(detail.send.readAt)}</strong>
                </div>
                <div>
                  <span>Acknowledged</span>
                  <strong>{formatDateTime(detail.send.acknowledgedAt)}</strong>
                </div>
                <div>
                  <span>Replied</span>
                  <strong>{formatDateTime(detail.send.repliedAt)}</strong>
                </div>
                <div>
                  <span>Complaint</span>
                  <strong>{formatDateTime(detail.send.complainedAt)}</strong>
                </div>
              </div>

              {detail.trackingLinks?.acknowledgeUrl && (
                <p className="muted small">
                  Acknowledgement link: <code>{detail.trackingLinks.acknowledgeUrl}</code>
                </p>
              )}

              {detail.trackingEvents.length === 0 ? (
                <p className="muted small">No tracking events recorded yet.</p>
              ) : (
                <ol className="event-list">
                  {detail.trackingEvents.map((event) => (
                    <li key={event.id}>
                      <span className="event-type">{trackingEventLabel(event.eventType)}</span>
                      <span className="muted small">
                        {trackingSourceLabel(event.source)} · {formatDateTime(event.occurredAt)}
                      </span>
                      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="detail-actions">
              {(detail.gmailUrl ?? gmailUrlFor(detail.send)) ? (
                <a
                  className="button"
                  href={detail.gmailUrl ?? gmailUrlFor(detail.send) ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Gmail Sent
                </a>
              ) : (
                <span className="muted small">No Gmail message ID yet.</span>
              )}
            </div>

            <div>
              <h4>Event history</h4>
              <ol className="event-list">
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <span className="event-type">{event.eventType}</span>
                    <span className="muted small">{formatDateTime(event.createdAt)}</span>
                    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
