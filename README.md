# Airlock

**Sensitive text is scrubbed on-device. Only the sanitized version ever reaches the cloud.**

Airlock is a document-assistant web app built on **Firebase AI Logic hybrid inference**. It answers the question every team asks before pasting a document into an LLM: *what exactly is leaving this machine?*

## How it works

1. **Scan (PREFER_ON_DEVICE)** — Gemini Nano scans the pasted document for PII: names, emails, phones, credentials, addresses, ID numbers. On browsers with the Prompt API, this inference never leaves the device; elsewhere Firebase AI Logic falls back to cloud `gemini-3.8-flash` — and the UI always says which backend answered.
2. **Airlock view** — every detected entity becomes a clickable `[type-N]` token in the rendered document. Click a token to release it back into the sanitized text (e.g. a public company name you don't need to hide).
3. **Cloud analysis (PREFER_IN_CLOUD)** — only the tokenized document crosses the airlock. The cloud model summarizes, lists action items, drafts replies, and answers Q&A against placeholders — it never sees the raw values.
4. **Data passport** — every inference is logged with the backend that served it (`on_device` / `cloud`) and how many bytes left the machine.

## The hybrid split

| Step | Mode | Model | Data boundary |
|---|---|---|---|
| PII scrub | `PREFER_ON_DEVICE` → cloud fallback | Gemini Nano / `gemini-3.8-flash` | raw text stays local when possible |
| Synthesis + Q&A | `PREFER_IN_CLOUD` | `gemini-3.8-flash` | receives `[token]`-ized text only |

`response.inferenceSource` drives the badge on every result — the app cannot silently mislabel a cloud answer as on-device.

## Stack

- React 19 + TypeScript + Vite
- `firebase/ai` (`getAI`, `getGenerativeModel`, `InferenceMode`)
- Firebase App Check (debug token supported for development)
- Firebase Hosting

## Run it

```bash
npm install
# optional: echo "VITE_APPCHECK_DEBUG_TOKEN=<registered debug token>" > .env.local
npm run dev
```

Deploy:

```bash
npm run build
firebase deploy --only hosting
```

For production App Check, set `VITE_RECAPTCHA_SITE_KEY` to a registered reCAPTCHA Enterprise site key.

Live demo: https://airlock-ai-ctill3005.web.app

Built for the #BuildHybridAI hackathon.

## License

Apache 2.0 — see [LICENSE](LICENSE).
