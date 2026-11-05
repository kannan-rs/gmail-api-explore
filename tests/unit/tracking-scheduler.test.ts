import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTrackingSyncScheduler } from '../../src/services/tracking-scheduler';

describe('startTrackingSyncScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately and then on the interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startTrackingSyncScheduler({ intervalMs: 1000, run });

    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits for the initial delay before the first run', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startTrackingSyncScheduler({ intervalMs: 1000, initialDelayMs: 500, run });

    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);

    stop();
  });

  it('does not overlap runs when a sync takes longer than the interval', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startTrackingSyncScheduler({ intervalMs: 1000, run });

    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);

    finish?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    stop();
  });

  it('reports errors and keeps scheduling', async () => {
    vi.useFakeTimers();
    const error = new Error('sync failed');
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = startTrackingSyncScheduler({ intervalMs: 1000, run, onError });

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);

    stop();
  });
});
