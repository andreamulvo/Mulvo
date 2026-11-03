// Caricamento e salvataggio dei dati.
// - Copia locale sempre aggiornata in localStorage (funziona anche offline).
// - Se è configurato un token GitHub, ogni modifica viene salvata come commit
//   nei file JSON della repo (data/formazione.json, data/swipe.json).

import { emptyData, emptySwipe, mergeData, mergeSwipe, normalizeData, normalizeSwipe } from './logic.js';

const FILES = {
  data: { path: 'data/formazione.json', ls: 'mulvo.formazione', normalize: normalizeData, merge: mergeData, empty: emptyData },
  swipe: { path: 'data/swipe.json', ls: 'mulvo.swipe', normalize: normalizeSwipe, merge: mergeSwipe, empty: emptySwipe },
};
const LS_CFG = 'mulvo.github';
const LS_DIRTY = 'mulvo.dirty';

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage pieno o bloccato */ } };

function guessRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    return { owner: host.split('.')[0], repo: location.pathname.split('/').filter(Boolean)[0] || `${host}` };
  }
  return { owner: 'andreamulvo', repo: 'Mulvo' };
}

export const store = {
  data: emptyData(),
  swipe: emptySwipe(),
  cfg: { ...guessRepo(), branch: 'main', token: '', ...(lsGet(LS_CFG) || {}) },
  status: { state: 'idle', message: '' },
  dirty: new Set(lsGet(LS_DIRTY) || []),
  messages: [],
  listeners: new Set(),
  timer: null,
};

function emit() {
  for (const fn of store.listeners) fn();
}

function setStatus(state, message = '') {
  store.status = { state, message };
  emit();
}

export function onChange(fn) {
  store.listeners.add(fn);
}

export function hasGithub() {
  const c = store.cfg;
  return Boolean(c.token && c.owner && c.repo && c.branch);
}

export function saveConfig(cfg) {
  store.cfg = { ...store.cfg, ...cfg };
  lsSet(LS_CFG, store.cfg);
}

/* ------------------------------------------------------------ GitHub API */

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

async function gh(path, init = {}) {
  const { owner, repo, token } = store.cfg;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}${init.method ? '' : `?ref=${encodeURIComponent(store.cfg.branch)}`}`, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return res;
}

async function readRemote(key) {
  const f = FILES[key];
  if (hasGithub()) {
    const res = await gh(f.path);
    if (res.status === 404) return { json: null, sha: null };
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || res.statusText}`);
    const body = await res.json();
    return { json: f.normalize(JSON.parse(b64decode(body.content))), sha: body.sha };
  }
  const res = await fetch(`${f.path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return { json: null, sha: null };
  return { json: f.normalize(await res.json()), sha: null };
}

export async function testConnection() {
  const { owner, repo, branch } = store.cfg;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${store.cfg.token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).message || ''}`.trim());
  return true;
}

/* ------------------------------------------------------------ ciclo dati */

export async function load() {
  for (const key of Object.keys(FILES)) {
    const f = FILES[key];
    const local = lsGet(f.ls);
    let remote = null;
    try {
      remote = (await readRemote(key)).json;
    } catch (err) {
      setStatus('error', `Lettura da GitHub non riuscita: ${err.message}`);
    }
    if (local && store.dirty.has(key)) store[key] = f.normalize(f.merge(f.normalize(local), remote));
    else store[key] = remote || (local ? f.normalize(local) : f.empty());
    lsSet(f.ls, store[key]);
  }
  if (store.dirty.size) scheduleSync(300);
  else setStatus(hasGithub() ? 'saved' : 'local');
}

/**
 * Applica una modifica: fn riceve l'oggetto (data o swipe) e lo muta.
 * `label` diventa il messaggio del commit.
 */
export function mutate(key, fn, label = 'aggiornamento') {
  fn(store[key]);
  store[key].updatedAt = new Date().toISOString();
  lsSet(FILES[key].ls, store[key]);
  store.dirty.add(key);
  lsSet(LS_DIRTY, [...store.dirty]);
  store.messages.push(label);
  emit();
  scheduleSync();
}

function scheduleSync(delay = 1500) {
  clearTimeout(store.timer);
  if (!hasGithub()) {
    setStatus('local', 'Salvato solo su questo dispositivo');
    return;
  }
  setStatus('pending');
  store.timer = setTimeout(sync, delay);
}

export async function sync() {
  if (!hasGithub() || !store.dirty.size) return;
  setStatus('saving');
  const labels = [...new Set(store.messages)].slice(-5);
  const message = `Formazione: ${labels.join(' · ') || 'aggiornamento'}`;
  try {
    for (const key of [...store.dirty]) {
      const f = FILES[key];
      for (let attempt = 0; ; attempt++) {
        const { json: remote, sha } = await readRemote(key);
        const merged = f.normalize(f.merge(store[key], remote));
        const res = await gh(f.path, {
          method: 'PUT',
          body: JSON.stringify({
            message,
            content: b64encode(`${JSON.stringify(merged, null, 2)}\n`),
            branch: store.cfg.branch,
            ...(sha ? { sha } : {}),
          }),
        });
        if (res.ok) {
          store[key] = merged;
          lsSet(f.ls, merged);
          store.dirty.delete(key);
          break;
        }
        if ((res.status === 409 || res.status === 422) && attempt < 2) continue; // qualcuno ha salvato nel frattempo: rileggo e riunisco
        throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || res.statusText}`);
      }
    }
    store.messages = [];
    lsSet(LS_DIRTY, [...store.dirty]);
    setStatus('saved', 'Salvato nella repo');
  } catch (err) {
    lsSet(LS_DIRTY, [...store.dirty]);
    setStatus('error', err.message);
  }
}

export function exportJSON(key) {
  return `${JSON.stringify(store[key], null, 2)}\n`;
}

export function importJSON(key, text) {
  const f = FILES[key];
  const parsed = f.normalize(JSON.parse(text));
  mutate(key, (obj) => {
    for (const k of Object.keys(obj)) delete obj[k];
    Object.assign(obj, parsed);
  }, 'import dati');
}

export function resetLocal() {
  for (const f of Object.values(FILES)) localStorage.removeItem(f.ls);
  localStorage.removeItem(LS_DIRTY);
}
