// Tiny DOM helpers. Text is always set with textContent; nothing here
// parses HTML strings.

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  testid?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.id) el.id = props.id;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.testid) el.dataset['testid'] = props.testid;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) {
        if (v === null || v === undefined || v === false) continue;
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (props.on) {
      for (const [type, fn] of Object.entries(props.on)) {
        if (fn) el.addEventListener(type, fn as EventListener);
      }
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? text(String(c)) : c);
  }
}

export function text(s: string): Text {
  return document.createTextNode(s);
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(
  tag: string,
  attrs: Record<string, string | number> = {},
  ...children: SVGElement[]
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

/** Simple line icons drawn with currentColor (24 x 24 grid). */
const ICONS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
  plus: 'M12 5v14 M5 12h14',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  send: 'M5 12h13 M13 6l6 6-6 6',
  stop: 'M7 7h10v10H7z',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
};

export function icon(name: keyof typeof ICONS | string, label?: string): SVGElement {
  const el = svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: 22,
      height: 22,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'icon',
    },
    svg('path', { d: ICONS[name] ?? '' }),
  );
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}

export function formatUsd(v: number): string {
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function formatRelative(iso: string | number, now = Date.now()): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}
