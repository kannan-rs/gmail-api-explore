export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseEmails(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function statusLabel(status: string): string {
  return status.slice(0, 1) + status.slice(1).toLowerCase();
}

export function trackingEventLabel(eventType: string): string {
  switch (eventType) {
    case 'DELIVERED':
      return 'Delivered';
    case 'DEFERRED':
      return 'Deferred';
    case 'BOUNCED':
      return 'Bounced';
    case 'OPENED':
      return 'Opened';
    case 'READ':
      return 'Read receipt';
    case 'ACKNOWLEDGED':
      return 'Acknowledged';
    case 'REPLIED':
      return 'Replied';
    case 'COMPLAINED':
      return 'Complaint';
    default:
      return statusLabel(eventType);
  }
}

export function trackingSourceLabel(source: string): string {
  switch (source) {
    case 'pixel':
      return 'tracking pixel';
    case 'ack_link':
      return 'acknowledgement link';
    case 'gmail_dsn':
      return 'Gmail bounce message';
    case 'gmail_mdn':
      return 'Gmail read receipt';
    case 'gmail_thread':
      return 'Gmail thread';
    case 'webhook':
      return 'webhook';
    default:
      return source;
  }
}
