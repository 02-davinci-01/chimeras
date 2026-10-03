// Loading build output and following rebuilds over SSE.
import type { Catalogue } from './types.ts';

export async function loadCatalogue(): Promise<Catalogue> {
  const res = await fetch('/catalogue.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`catalogue.json: HTTP ${res.status}. Run npm run build.`);
  return res.json();
}

let searchText: Record<string, string> | null = null;
let searchLoading: Promise<Record<string, string>> | null = null;

/** Full review text by album id; fetched on first use. */
export function loadSearch(force = false): Promise<Record<string, string>> {
  if (force) { searchText = null; searchLoading = null; }
  if (searchText) return Promise.resolve(searchText);
  searchLoading ??= fetch('/search.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).then(s => (searchText = s));
  return searchLoading;
}
export const reviewText = (id: string) => searchText?.[id] ?? '';

/** Call `fn` after every rebuild. */
export function onRebuild(fn: () => void) {
  // Only the local dev server rebuilds; a static host has no /events to listen to.
  if (!import.meta.env.DEV || !('EventSource' in window)) return;
  const es = new EventSource('/events');
  es.addEventListener('build', () => { loadSearch(true); fn(); });
  es.addEventListener('build-error', e => console.warn('build failed:', JSON.parse((e as MessageEvent).data).message));
}

/** localStorage that never throws. */
export const store = {
  get<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
