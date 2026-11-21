import { useCallback, useMemo, useRef, useState } from 'react';
import { detectPii, analyzeDocument, askQuestion, type Source } from './ai';
import { buildRedaction, sanitizedText, type Segment } from './redact';
import './App.css';

interface LedgerEntry {
  id: number;
  step: string;
  source: Source;
  bytesOff: number;
  at: Date;
}

const SAMPLE = `From: Maria Chen <maria.chen@northwind-logistics.com>
To: ops-team@acme-freight.io
Subject: Q4 dock schedule + access credentials

Hi team,

The Port of Oakland berth 22 window moved to Dec 3, 06:00. Please confirm
with our dispatcher Ray Okafor at +1 (415) 555-0142 before Friday.

Staging credentials for the yard gate kiosk:
  user: yard-ops
  pass: OKD-8842-VX

Also, the invoice for container MSKU-771204-5 goes to Accounts Payable,
attn: Dev Patel, 1200 Harbor Bay Pkwy, Alameda CA 94502. His direct line
is 510-555-0187.

One driver flagged a health accommodation — Jamal Rivers (license
D8834211) needs the early shift through February.

Thanks,
Maria`;

const SOURCE_BADGE: Record<Source, { label: string; cls: string }> = {
  on_device: { label: 'on-device · Gemini Nano', cls: 'badge-nano' },
  cloud: { label: 'cloud · Gemini', cls: 'badge-cloud' },
  unknown: { label: 'model', cls: 'badge-unknown' },
};

function Badge({ s }: { s: Source }) {
  const b = SOURCE_BADGE[s];
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

function mdToHtml(md: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const t = line.trim();
    if (/^##\s/.test(t)) { closeList(); out.push(`<h3>${esc(t.replace(/^##\s*/, ''))}</h3>`); continue; }
    if (/^#\s/.test(t)) { closeList(); out.push(`<h2>${esc(t.replace(/^#\s*/, ''))}</h2>`); continue; }
    const cb = t.match(/^- \[([ xX])\]\s*(.*)$/);
    if (cb) {
      if (!inList) { out.push('<ul class="checklist">'); inList = true; }
      out.push(`<li class="${cb[1] === ' ' ? '' : 'done'}">${inline(cb[2])}</li>`);
      continue;
    }
    if (/^[-*]\s/.test(t)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (t) out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join('\n');

  function inline(s: string): string {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[/g, '<span class="tok-ref">[').replace(/\]/g, ']</span>');
  }
}

export default function App() {
  const [doc, setDoc] = useState(SAMPLE);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [scrubSource, setScrubSource] = useState<Source>('unknown');
  const [scrubbing, setScrubbing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzeSource, setAnalyzeSource] = useState<Source>('unknown');
  const [analyzing, setAnalyzing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const idRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLedger = useCallback((step: string, source: Source, bytesOff: number) => {
    setLedger((l) => [...l, { id: ++idRef.current, step, source, bytesOff, at: new Date() }]);
  }, []);

  const scrub = useCallback(async () => {
    if (!doc.trim() || scrubbing) return;
    setScrubbing(true); setErr(null); setAnalysis(null); setAnswer(null);
    try {
      const { entities, source } = await detectPii(doc);
      setScrubSource(source);
      setSegments(buildRedaction(doc, entities).segments);
      addLedger('PII scan', source, source === 'on_device' ? 0 : doc.length);
    } catch (e) {
      setErr(`Scrub failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScrubbing(false);
    }
  }, [doc, scrubbing, addLedger]);

  const analyze = useCallback(async () => {
    if (!segments || analyzing) return;
    const clean = sanitizedText(segments);
    setAnalyzing(true); setErr(null);
    try {
      const { markdown, source } = await analyzeDocument(clean);
      setAnalysis(markdown); setAnalyzeSource(source);
      addLedger('Analysis', source, clean.length);
    } catch (e) {
      setErr(`Analysis failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }, [segments, analyzing, addLedger]);

  const ask = useCallback(async () => {
    if (!segments || !question.trim() || asking) return;
    const clean = sanitizedText(segments);
    setAsking(true); setErr(null);
    try {
      const { markdown, source } = await askQuestion(clean, question.trim());
      setAnswer(`${markdown}\n\n— <Badge:${source}>`);
      addLedger('Q&A', source, clean.length + question.length);
    } catch (e) {
      setErr(`Q&A failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAsking(false);
    }
  }, [segments, question, asking, addLedger]);

  const toggleToken = useCallback((id: string) => {
    setSegments((segs) =>
      segs?.map((s) =>
        s.kind === 'token' && s.token!.id === id
          ? { ...s, token: { ...s.token!, enabled: !s.token!.enabled } }
          : s,
      ) ?? null,
    );
  }, []);

  const loadFile = useCallback((f: File) => {
    f.text().then((t) => { setDoc(t.slice(0, 60000)); setSegments(null); setAnalysis(null); setAnswer(null); });
  }, []);

  const totalOff = useMemo(() => ledger.reduce((a, e) => a + e.bytesOff, 0), [ledger]);
  const tokenCount = useMemo(() => segments?.filter((s) => s.kind === 'token').length ?? 0, [segments]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">⛨</span>
          <div>
            <h1>Airlock</h1>
            <p className="tagline">Sensitive text is scrubbed on-device. Only the sanitized version ever reaches the cloud.</p>
          </div>
        </div>
        <div className="header-right">
          <span className="pill">Firebase AI Logic · hybrid inference</span>
        </div>
      </header>

      <main>
        <section className="panel input-panel">
          <div className="panel-head">
            <h2>1 · Document</h2>
            <div className="row">
              <button className="ghost" onClick={() => fileRef.current?.click()}>Load .txt/.md</button>
              <button className="ghost" onClick={() => { setDoc(SAMPLE); setSegments(null); setAnalysis(null); setAnswer(null); }}>Sample</button>
              <input ref={fileRef} type="file" accept=".txt,.md,.log,.csv" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
            </div>
          </div>
          <textarea
            value={doc}
            onChange={(e) => { setDoc(e.target.value); setSegments(null); setAnalysis(null); setAnswer(null); }}
            placeholder="Paste a document containing names, emails, credentials…"
            spellCheck={false}
          />
          <div className="panel-foot">
            <span className="muted">{doc.length.toLocaleString()} chars</span>
            <button className="primary" onClick={scrub} disabled={scrubbing || !doc.trim()}>
              {scrubbing ? 'Scanning…' : 'Scan for PII'}
            </button>
          </div>
        </section>

        <section className="panel scrub-panel">
          <div className="panel-head">
            <h2>2 · Airlock view</h2>
            {segments && <Badge s={scrubSource} />}
          </div>
          <div className="scrub-view">
            {!segments && <p className="muted">Run the scan — every entity the on-device model flags becomes a <span className="tok">[token]</span> here. Click a token to keep or release it.</p>}
            {segments && tokenCount === 0 && <p className="muted">No sensitive entities detected. The document can go to the cloud as-is.</p>}
            {segments && tokenCount > 0 && (
              <pre className="scrubbed">{segments.map((s, i) =>
                s.kind === 'token' ? (
                  <button
                    key={i}
                    className={`tok ${s.token!.enabled ? '' : 'tok-off'}`}
                    title={`${s.token!.type}: ${s.token!.value}${s.token!.enabled ? ' — click to release' : ' — click to re-redact'}`}
                    onClick={() => toggleToken(s.token!.id)}
                  >[{s.token!.enabled ? s.token!.id : s.token!.value}]</button>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}</pre>
            )}
          </div>
          <div className="panel-foot">
            <span className="muted">{segments ? `${tokenCount} entities tokenized` : ''}</span>
            <button className="primary" onClick={analyze} disabled={!segments || analyzing}>
              {analyzing ? 'Analyzing…' : 'Send sanitized → cloud'}
            </button>
          </div>
        </section>

        <section className="panel out-panel">
          <div className="panel-head">
            <h2>3 · Cloud analysis</h2>
            {analysis && <Badge s={analyzeSource} />}
          </div>
          <div className="analysis">
            {!analysis && !answer && <p className="muted">Only the tokenized document is sent. Answers arrive with <span className="tok">[token]</span> placeholders — nothing sensitive ever crossed the airlock.</p>}
            {analysis && <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(analysis) }} />}
          </div>
          {segments && (
            <div className="qa">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="Ask about the sanitized document…"
              />
              <button className="ghost" onClick={ask} disabled={asking || !question.trim()}>{asking ? '…' : 'Ask'}</button>
            </div>
          )}
          {answer && (
            <div className="analysis answer">
              <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(answer.replace(/\n\n— <Badge:(.+)>/, '')) }} />
              <Badge s={(answer.match(/<Badge:(.+?)>/)?.[1] as Source) ?? 'unknown'} />
            </div>
          )}
          {err && <p className="error">{err}</p>}
        </section>
      </main>

      <footer className="passport">
        <div className="passport-head">
          <h2>Data passport</h2>
          <span className="muted">{totalOff.toLocaleString()} bytes left this device</span>
        </div>
        {ledger.length === 0 && <p className="muted">Every inference is logged here with the backend that served it and how many bytes left the machine.</p>}
        {ledger.length > 0 && (
          <table>
            <thead><tr><th>Step</th><th>Backend</th><th>Bytes off-device</th><th>Time</th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td>{e.step}</td>
                  <td><Badge s={e.source} /></td>
                  <td>{e.bytesOff.toLocaleString()}</td>
                  <td>{e.at.toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </footer>
    </div>
  );
}
