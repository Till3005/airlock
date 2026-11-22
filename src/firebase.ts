import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

const firebaseConfig = {
  projectId: 'airlock-ai-ctill3005',
  appId: '1:503056958577:web:51501b7feb3af1e7fd87d0',
  storageBucket: 'airlock-ai-ctill3005.firebasestorage.app',
  apiKey: 'AIzaSyAfGQRb-s2FMiQuNaZCkWP38gGAnaUXwcs',
  authDomain: 'airlock-ai-ctill3005.firebaseapp.com',
  messagingSenderId: '503056958577',
};

export const app = initializeApp(firebaseConfig);

// App Check must be initialized before getAI() — the AI SDK snapshots the
// app-check provider at getAI() time, so a later initializeAppCheck() leaves
// requests going out without an App Check token.
const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
if (debugToken) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
}
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
export const appCheck: AppCheck | null = (siteKey || debugToken)
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey ?? 'unused-with-debug-token'),
      isTokenAutoRefreshEnabled: true,
    })
  : null;

export const ai = getAI(app);

// Scrubber: prefers the on-device model so sensitive text never leaves the
// device on capable browsers. Falls back to cloud only when on-device is
// unavailable — the UI surfaces exactly which backend answered.
export const scrubber: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: { model: 'gemini-3.8-flash' },
});

// Same scrub job pinned to cloud: used when Gemini Nano isn't ready on this
// browser (still downloading or absent), so the request doesn't stall on the
// on-device probe.
export const scrubberCloud: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: 'gemini-3.8-flash' },
});

// Whether an on-device model can serve a prompt right now.
export async function onDeviceReady(): Promise<boolean> {
  try {
    const lm = (self as unknown as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel;
    return !!lm && (await lm.availability()) === 'available';
  } catch {
    return false;
  }
}

// Analyst: prefers the stronger cloud model for synthesis quality, falling
// back to the on-device model when offline or unauthenticated — the other
// direction of the same hybrid SDK.
export const analyst: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  inCloudParams: { model: 'gemini-3.8-flash' },
});

// Capacity fallback: when the primary cloud model is saturated (5xx), the
// caller retries once on the lite variant rather than failing the request.
export const scrubberLite: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  inCloudParams: { model: 'gemini-3.1-flash-lite' },
});
export const analystLite: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  inCloudParams: { model: 'gemini-3.1-flash-lite' },
});

export type Source = 'on_device' | 'cloud' | 'unknown';

export function sourceOf(res: { inferenceSource?: string }): Source {
  if (res.inferenceSource === 'on_device') return 'on_device';
  if (res.inferenceSource === 'in_cloud') return 'cloud';
  return 'unknown';
}
