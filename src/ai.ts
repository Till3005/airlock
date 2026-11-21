import { scrubber, analyst, sourceOf } from './firebase';
export type { Source } from './firebase';
import type { Source } from './firebase';

export interface PiiEntity {
  type: string;
  value: string;
}

export interface ScrubResult {
  entities: PiiEntity[];
  source: Source;
}

export interface AnalyzeResult {
  markdown: string;
  source: Source;
}

const SCRUB_PROMPT = (text: string) => `You are a PII extraction engine inside a privacy airlock. Find every piece of personally identifiable or otherwise sensitive information in the document below: names of people, email addresses, phone numbers, physical addresses, ID/passport/license numbers, dates of birth, credit card / bank / account numbers, IP addresses, passwords, API keys / tokens, health information, and full URLs containing credentials.

Return ONLY a JSON array of objects, no prose, no markdown fences:
[{"type":"person"|"email"|"phone"|"address"|"id_number"|"dob"|"financial"|"credential"|"ip"|"url"|"other","value":"<exact substring from the document>"}]

Rules:
- "value" must be the exact substring as it appears in the document.
- Do not invent entities that are not present.
- Keep each entity to the minimal span (e.g. just the email, not the surrounding sentence).
- If nothing is sensitive, return [].

DOCUMENT:
"""
${text}
"""`;

export async function detectPii(text: string): Promise<ScrubResult> {
  const res = await scrubber.generateContent(SCRUB_PROMPT(text));
  const source = sourceOf(res.response);
  const raw = res.response.text().trim();
  let entities: PiiEntity[] = [];
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) {
        entities = parsed
          .filter((e): e is PiiEntity => !!e && typeof e === 'object' && typeof (e as PiiEntity).value === 'string' && typeof (e as PiiEntity).type === 'string')
          .filter((e) => text.includes(e.value));
      }
    }
  } catch {
    entities = [];
  }
  // de-duplicate identical value+type pairs
  const seen = new Set<string>();
  entities = entities.filter((e) => {
    const k = `${e.type}|${e.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { entities, source };
}

const ANALYZE_PROMPT = (text: string) => `You are an analyst working inside a privacy airlock. The document below has already been scrubbed of sensitive entities (they appear as tokens like [person-1]).

Produce a tight analysis in Markdown:

## Summary
3-5 bullets on what this document is and what matters.

## Action items
Checkbox list (- [ ]) of concrete next steps, or "None".

## Suggested replies
If the document is a message/thread expecting a response, draft a short reply that uses the [token] placeholders exactly (the airlock will re-inflate them after you respond). If not applicable, write "N/A".

DOCUMENT:
"""
${text}
"""`;

export async function analyzeDocument(text: string): Promise<AnalyzeResult> {
  const res = await analyst.generateContent(ANALYZE_PROMPT(text));
  return { markdown: res.response.text(), source: sourceOf(res.response) };
}

export async function askQuestion(sanitized: string, question: string): Promise<AnalyzeResult> {
  const res = await analyst.generateContent(
    `Document (scrubbed, sensitive entities appear as [type-N] tokens):\n"""\n${sanitized}\n"""\n\nQuestion: ${question}\n\nAnswer concisely. Use the [token] placeholders verbatim when referring to redacted entities.`,
  );
  return { markdown: res.response.text(), source: sourceOf(res.response) };
}
