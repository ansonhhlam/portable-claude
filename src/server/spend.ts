import { z } from 'zod';
import type { SpendInfo } from '../shared/api.js';
import { JsonFile } from './fsutil.js';

const SpendSchema = z.object({
  days: z.record(z.string(), z.number().nonnegative()),
  capNotified: z.string().nullable().default(null),
});
type SpendData = z.infer<typeof SpendSchema>;

export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Daily spend totals (estimated by the SDK) and the optional daily cap. */
export class SpendTracker {
  private file: JsonFile<SpendData>;

  constructor(
    file: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = new JsonFile(file, SpendSchema, () => ({ days: {}, capNotified: null }));
  }

  today(): number {
    return this.file.get().days[localDate(this.now())] ?? 0;
  }

  add(usd: number): void {
    if (!(usd > 0)) return;
    this.file.update((d) => {
      const key = localDate(this.now());
      d.days[key] = Number(((d.days[key] ?? 0) + usd).toFixed(6));
      const keys = Object.keys(d.days).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - 90))) delete d.days[old];
    });
  }

  capReached(capUsd: number | null): boolean {
    return capUsd !== null && this.today() >= capUsd;
  }

  /** True the first time it is called on a day the cap is reached (for notifications). */
  shouldNotifyCap(capUsd: number | null): boolean {
    if (!this.capReached(capUsd)) return false;
    const today = localDate(this.now());
    if (this.file.get().capNotified === today) return false;
    this.file.update((d) => {
      d.capNotified = today;
    });
    return true;
  }

  info(capUsd: number | null): SpendInfo {
    return {
      todayUsd: this.today(),
      dailyCapUsd: capUsd,
      capReached: this.capReached(capUsd),
      date: localDate(this.now()),
    };
  }
}
