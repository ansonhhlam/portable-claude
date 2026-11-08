import type { DiffPreview } from '../shared/api.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max) + '\n…', truncated: true };
}

/** One-line, human-readable description of a tool call. */
export function summarizeTool(name: string, input: Record<string, unknown>): string {
  const pick =
    name === 'Bash' || name === 'PowerShell'
      ? str(input.command)
      : ['Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit'].includes(name)
        ? (str(input.file_path) ?? str(input.notebook_path))
        : name === 'Glob' || name === 'Grep'
          ? str(input.pattern)
          : name === 'WebFetch'
            ? str(input.url)
            : name === 'WebSearch'
              ? str(input.query)
              : name === 'Task' || name === 'Agent'
                ? str(input.description)
                : undefined;
  const text = pick ?? Object.values(input).find((v): v is string => typeof v === 'string') ?? '';
  return truncate(text.replace(/\s+/g, ' ').trim(), 300).text;
}

const MAX_DIFF_LINES = 60;

/** A simple before/after preview for Edit, MultiEdit and Write requests. */
export function diffPreview(name: string, input: Record<string, unknown>): DiffPreview | null {
  const file = str(input.file_path);
  if (!file) return null;
  const lines: DiffPreview['lines'] = [];
  const add = (kind: 'add' | 'del', text: string) => {
    for (const l of text.split('\n')) lines.push({ kind, text: l });
  };
  if (name === 'Edit') {
    add('del', str(input.old_string) ?? '');
    add('add', str(input.new_string) ?? '');
  } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits as Record<string, unknown>[]) {
      add('del', str(e.old_string) ?? '');
      add('add', str(e.new_string) ?? '');
      lines.push({ kind: 'ctx', text: '…' });
    }
  } else if (name === 'Write') {
    add('add', str(input.content) ?? '');
  } else {
    return null;
  }
  const truncated = lines.length > MAX_DIFF_LINES;
  return {
    path: file,
    lines: lines.slice(0, MAX_DIFF_LINES).map((l) => ({ ...l, text: l.text.slice(0, 400) })),
    truncated,
  };
}

/** Flatten tool_result content (string or content blocks) to text. */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: unknown) => {
        if (b && typeof b === 'object') {
          const o = b as Record<string, unknown>;
          if (typeof o.text === 'string') return o.text;
          if (o.type === 'image') return '[image]';
        }
        return '';
      })
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

/** Pretty JSON of the full input, size-limited. */
export function inputJson(input: Record<string, unknown>, max = 20_000): string {
  return truncate(JSON.stringify(input, null, 2), max).text;
}
