import type { SendRow } from '../api';

type TrackingBadgeSend = Pick<
  SendRow,
  | 'deliveredAt'
  | 'bouncedAt'
  | 'openedAt'
  | 'openCount'
  | 'readAt'
  | 'acknowledgedAt'
  | 'repliedAt'
  | 'complainedAt'
>;

interface TrackingBadge {
  label: string;
  tone: string;
}

export function TrackingBadges({ send }: { send: TrackingBadgeSend }) {
  const badges: TrackingBadge[] = [];
  if (send.deliveredAt) {
    badges.push({ label: 'Delivered', tone: 'delivered' });
  }
  if (send.bouncedAt) {
    badges.push({ label: 'Bounced', tone: 'bounced' });
  }
  if (send.openedAt) {
    badges.push({
      label: send.openCount > 1 ? `Opened ${send.openCount}x` : 'Opened',
      tone: 'opened',
    });
  }
  if (send.readAt) {
    badges.push({ label: 'Read', tone: 'read' });
  }
  if (send.acknowledgedAt) {
    badges.push({ label: 'Ack', tone: 'acknowledged' });
  }
  if (send.repliedAt) {
    badges.push({ label: 'Replied', tone: 'replied' });
  }
  if (send.complainedAt) {
    badges.push({ label: 'Complaint', tone: 'complained' });
  }

  if (badges.length === 0) {
    return <span className="muted">—</span>;
  }

  return (
    <div className="badge-row">
      {badges.map((badge) => (
        <span key={badge.tone} className={`badge tracking-${badge.tone}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}
