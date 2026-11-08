import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToHtml } from '../../src/web/markdown.js';
import { urlBase64ToUint8Array } from '../../src/web/push.js';
import { runFinishedText } from '../../src/web/views/timeline.js';
import { guessDeviceName } from '../../src/web/views/login.js';

describe('markdownToHtml', () => {
  it('renders basic Markdown', () => {
    const html = markdownToHtml('Hello **world**\n\n- one\n- two\n\n`code`');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<code>code</code>');
  });

  it('escapes script tags and other raw HTML', () => {
    const html = markdownToHtml(
      'before\n\n<script>alert(1)</script>\n\nafter <b onclick="x()">hi</b>',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<b /i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b onclick=');
  });

  it('escapes HTML inside code blocks', () => {
    const html = markdownToHtml('```\n<img src=x onerror=alert(1)>\n```');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img');
  });

  it('drops javascript: and data: links but keeps their text', () => {
    const html = markdownToHtml(
      '[click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [rel](./x)',
    );
    expect(html).not.toMatch(/href/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('click');
    expect(html).toContain('data');
  });

  it('keeps https and mailto links and opens them safely', () => {
    const html = markdownToHtml(
      '[docs](https://example.com/a?b=1&c=2 "Docs") <mailto:you@example.com>',
    );
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=2" title="Docs" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(html).toMatch(/<a href="mailto:you@example.com"[^>]*rel="noopener noreferrer"/);
  });

  it('turns bare URLs into safe links', () => {
    const html = markdownToHtml('see https://example.com');
    expect(html).toMatch(
      /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">/,
    );
  });

  it('drops images so no remote content loads', () => {
    const html = markdownToHtml('![tracker](https://example.com/p.png)');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('tracker');
  });

  it('escapeHtml escapes all special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding', () => {
    // "hello?>" in base64 is "aGVsbG8/Pg==", base64url "aGVsbG8_Pg".
    const bytes = urlBase64ToUint8Array('aGVsbG8_Pg');
    expect(Array.from(bytes)).toEqual([...Buffer.from('hello?>')]);
  });

  it('decodes a 65-byte VAPID-style key', () => {
    const raw = Buffer.alloc(65, 0);
    raw[0] = 4;
    for (let i = 1; i < 65; i++) raw[i] = (i * 37) % 256;
    const key = raw.toString('base64url');
    expect(key).not.toContain('=');
    const out = urlBase64ToUint8Array(key);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(65);
    expect(Buffer.from(out).equals(raw)).toBe(true);
  });

  it('handles - and _ characters', () => {
    const raw = Buffer.from([0xfb, 0xff, 0xfe]);
    expect(raw.toString('base64url')).toBe('-__-');
    expect(Array.from(urlBase64ToUint8Array('-__-'))).toEqual([0xfb, 0xff, 0xfe]);
  });
});

describe('guessDeviceName', () => {
  const cases: [string, string][] = [
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'iPhone Safari',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
      'iPhone Chrome',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'iPad Safari',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      'Android phone Chrome',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Android tablet Chrome',
    ],
    [
      'Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
      'Android phone Firefox',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Windows PC Edge',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Mac Safari',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Linux PC Firefox'],
    ['curl/8.0', 'Browser'],
  ];
  it.each(cases)('%#: guesses %s', (ua, expected) => {
    expect(guessDeviceName(ua)).toBe(expected);
  });
});

describe('runFinishedText', () => {
  const base = {
    runId: 'r1',
    isError: false,
    subtype: 'success',
    costUsd: 0.0123,
    durationMs: 12300,
    turns: 3,
    errors: [],
  };

  it('summarizes a successful run', () => {
    expect(runFinishedText(base)).toBe('Done · $0.01 · 12.3s · 3 turns');
  });

  it('shows small costs with more precision and a single turn', () => {
    expect(runFinishedText({ ...base, costUsd: 0.0042, durationMs: 800, turns: 1 })).toBe(
      'Done · $0.0042 · 800ms · 1 turn',
    );
  });

  it('marks errors with their subtype', () => {
    expect(
      runFinishedText({
        ...base,
        isError: true,
        subtype: 'error_max_turns',
        costUsd: 0,
        durationMs: 125000,
        turns: 10,
      }),
    ).toBe('Error (error_max_turns) · $0.00 · 2m 5s · 10 turns');
    expect(runFinishedText({ ...base, isError: true, subtype: 'error' })).toMatch(/^Error · /);
  });
});
