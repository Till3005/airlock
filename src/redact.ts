import type { PiiEntity } from './ai';

export interface Token {
  id: string; // e.g. person-1
  type: string;
  value: string;
  enabled: boolean;
}

export interface Segment {
  kind: 'text' | 'token';
  text: string;
  token?: Token;
}

export interface Redaction {
  tokens: Token[];
  segments: Segment[];
  sanitized: string;
}

export function buildRedaction(doc: string, entities: PiiEntity[]): Redaction {
  // Resolve overlapping matches: longest value wins, first occurrence order.
  const sorted = [...entities].sort((a, b) => b.value.length - a.value.length);
  const ranges: { start: number; end: number; entity: PiiEntity }[] = [];
  for (const e of sorted) {
    let idx = doc.indexOf(e.value);
    while (idx !== -1) {
      const end = idx + e.value.length;
      if (!ranges.some((r) => idx < r.end && end > r.start)) {
        ranges.push({ start: idx, end, entity: e });
        break;
      }
      idx = doc.indexOf(e.value, idx + 1);
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const countByType = new Map<string, number>();
  const tokens: Token[] = [];
  const segments: Segment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ kind: 'text', text: doc.slice(cursor, r.start) });
    const n = (countByType.get(r.entity.type) ?? 0) + 1;
    countByType.set(r.entity.type, n);
    const token: Token = { id: `${r.entity.type}-${n}`, type: r.entity.type, value: r.entity.value, enabled: true };
    tokens.push(token);
    segments.push({ kind: 'token', text: `[${token.id}]`, token });
    cursor = r.end;
  }
  if (cursor < doc.length) segments.push({ kind: 'text', text: doc.slice(cursor) });
  return { tokens, segments, sanitized: sanitizedText(segments) };
}

export function sanitizedText(segments: Segment[]): string {
  return segments
    .map((s) => (s.kind === 'token' ? (s.token!.enabled ? `[${s.token!.id}]` : s.token!.value) : s.text))
    .join('');
}
