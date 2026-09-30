/**
 * Recording time that excludes pauses — the clock every coaching event is stamped with
 * (`at_ms`), matching the Co-play IDE's "video-relative milliseconds, excluding pauses".
 * `now` is injectable so tests do not depend on the wall clock.
 */
export class RecordingClock {
  private accumulatedMs = 0;
  private runningSince: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  start(): void {
    this.accumulatedMs = 0;
    this.runningSince = this.now();
  }

  pause(): void {
    if (this.runningSince === null) return;
    this.accumulatedMs += this.now() - this.runningSince;
    this.runningSince = null;
  }

  resume(): void {
    if (this.runningSince !== null) return;
    this.runningSince = this.now();
  }

  get paused(): boolean {
    return this.runningSince === null;
  }

  elapsedMs(): number {
    const running =
      this.runningSince === null ? 0 : this.now() - this.runningSince;
    return Math.round(this.accumulatedMs + running);
  }
}
