import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../../src/server/eventlog.js';
import { tmpDir } from './helpers.js';

function newLog() {
  const dir = tmpDir();
  return { file: path.join(dir, 's', 'events.jsonl'), dir };
}

describe('EventLog', () => {
  it('assigns monotonic sequence numbers and persists events', () => {
    const { file } = newLog();
    const log = new EventLog(file);
    const a = log.append('user.message', { text: 'hello', queued: false });
    const b = log.append('state', { state: 'working' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    log.close();
    const again = new EventLog(file);
    expect(again.all().map((e) => e.seq)).toEqual([1, 2]);
    expect(again.lastSeq).toBe(2);
    expect(again.append('state', { state: 'idle' }).seq).toBe(3);
  });

  it('replays only events after a sequence number', () => {
    const { file } = newLog();
    const log = new EventLog(file);
    for (let i = 0; i < 10; i++) log.append('notice', { level: 'info', message: `n${i}` });
    expect(log.since(0)).toHaveLength(10);
    expect(log.since(7).map((e) => e.seq)).toEqual([8, 9, 10]);
    expect(log.since(10)).toEqual([]);
    expect(log.since(99)).toEqual([]);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const { file } = newLog();
    const log = new EventLog(file);
    const seen: number[] = [];
    const off = log.subscribe((e) => seen.push(e.seq));
    log.append('state', { state: 'working' });
    off();
    log.append('state', { state: 'idle' });
    expect(seen).toEqual([1]);
  });

  it('keeps working when a listener throws', () => {
    const { file } = newLog();
    const log = new EventLog(file);
    log.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => log.append('state', { state: 'idle' })).not.toThrow();
  });

  it('recovers from a truncated last line after a crash', () => {
    const { file } = newLog();
    const log = new EventLog(file);
    log.append('user.message', { text: 'one', queued: false });
    log.append('user.message', { text: 'two', queued: false });
    log.close();
    fs.appendFileSync(file, '{"seq":3,"ts":"2026-01-01T00:00:00.000Z","type":"user.mes');
    const recovered = new EventLog(file);
    expect(recovered.report.truncatedBytes).toBeGreaterThan(0);
    expect(recovered.all().map((e) => e.seq)).toEqual([1, 2]);
    // The file itself was repaired so new appends form valid lines.
    recovered.append('state', { state: 'idle' });
    recovered.close();
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('skips corrupt or out-of-order lines in the middle', () => {
    const { file } = newLog();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ev = (seq: number) => JSON.stringify({ seq, ts: 't', type: 'state', data: { state: 'idle' } });
    fs.writeFileSync(file, [ev(1), 'not json', ev(2), ev(2), '', ev(3)].join('\n') + '\n');
    const log = new EventLog(file);
    expect(log.all().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.report.skippedLines).toBe(2);
  });
});
