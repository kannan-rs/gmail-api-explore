export interface TrackingSyncSchedulerOptions {
  intervalMs: number;
  initialDelayMs?: number;
  run: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export function startTrackingSyncScheduler(options: TrackingSyncSchedulerOptions): () => void {
  const initialDelayMs = options.initialDelayMs ?? 0;
  let stopped = false;
  let running = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let kickoff: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      await options.run();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  }

  function startInterval(): void {
    interval = setInterval(() => {
      void tick();
    }, options.intervalMs);
    interval.unref?.();
  }

  if (initialDelayMs <= 0) {
    void tick();
    startInterval();
  } else {
    kickoff = setTimeout(() => {
      void tick();
      startInterval();
    }, initialDelayMs);
    kickoff.unref?.();
  }

  return () => {
    stopped = true;
    if (kickoff) {
      clearTimeout(kickoff);
    }
    if (interval) {
      clearInterval(interval);
    }
  };
}
