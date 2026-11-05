// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TrackingBadges } from '../../web/src/components/TrackingBadges';

function send(overrides: Record<string, unknown> = {}) {
  return {
    deliveredAt: null,
    bouncedAt: null,
    bounceType: null,
    deferredAt: null,
    deferredCount: 0,
    openedAt: null,
    openCount: 0,
    readAt: null,
    acknowledgedAt: null,
    repliedAt: null,
    complainedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('TrackingBadges', () => {
  it('distinguishes hard bounces, soft bounces, and deferred sends', () => {
    render(
      <>
        <TrackingBadges
          send={send({ bouncedAt: '2026-11-02T10:00:00.000Z', bounceType: 'hard' })}
        />
        <TrackingBadges
          send={send({ bouncedAt: '2026-11-02T10:00:00.000Z', bounceType: 'soft' })}
        />
        <TrackingBadges send={send({ deferredAt: '2026-11-02T10:00:00.000Z', deferredCount: 2 })} />
      </>,
    );

    expect(screen.getByText('Hard bounce')).toBeTruthy();
    expect(screen.getByText('Soft bounce')).toBeTruthy();
    expect(screen.getByText('Deferred 2x')).toBeTruthy();
  });

  it('labels an unclassified bounce without inventing a type', () => {
    render(<TrackingBadges send={send({ bouncedAt: '2026-11-02T10:00:00.000Z' })} />);

    expect(screen.getByText('Bounced')).toBeTruthy();
  });
});
