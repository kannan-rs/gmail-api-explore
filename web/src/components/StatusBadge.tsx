import { statusLabel } from '../format';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{statusLabel(status)}</span>;
}
