// Logica pura della sezione Formazione: nessun accesso a DOM o rete.
// Tutte le date sono stringhe 'YYYY-MM-DD' (giorno locale), calcolate in UTC
// per evitare sorprese con l'ora legale.

export const STATUSES = {
  da_iniziare: 'Da iniziare',
  in_corso: 'In corso',
  in_pausa: 'In pausa',
  completato: 'Completato',
};

export const CATEGORIES = [
  'Social media', 'Ads', 'UX/UI', 'AI', 'Copywriting',
  'Analytics', 'Strategia', 'Video', 'Altro',
];

export const DEFAULT_SETTINGS = { weeklyGoalMinutes: 180, staleDays: 7 };

export function emptyData() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    courses: [],
    sessions: [],
    reviews: {},
    milestones: [],
    deleted: [],
  };
}

export function emptySwipe() {
  return { version: 1, items: [], deleted: [] };
}

/** Completa un oggetto dati letto da JSON con i campi mancanti. */
export function normalizeData(raw) {
  const d = { ...emptyData(), ...(raw || {}) };
  d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  d.courses = (d.courses || []).map((c) => ({ modules: [], ...c, modules: (c.modules || []).map((m) => ({ done: false, doneAt: null, learned: '', ideaSent: false, ...m })) }));
  d.sessions = d.sessions || [];
  d.reviews = d.reviews || {};
  d.milestones = d.milestones || [];
  d.deleted = d.deleted || [];
  return d;
}

export function normalizeSwipe(raw) {
  const s = { ...emptySwipe(), ...(raw || {}) };
  s.items = s.items || [];
  s.deleted = s.deleted || [];
  return s;
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------------------------------------------------------------- date */

const DAY = 86400000;

function utc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso, n) {
  return fromUtc(utc(iso) + n * DAY);
}

/** Giorni da a → b (positivo se b è dopo a). */
export function diffDays(a, b) {
  return Math.round((utc(b) - utc(a)) / DAY);
}

/** 0 = lunedì … 6 = domenica */
export function weekday(iso) {
  return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso) {
  return addDays(iso, -weekday(iso));
}

export function weekKey(iso) {
  const t = new Date(utc(iso));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const wk = Math.ceil(((t - yearStart) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export function weekRange(key) {
  const [y, w] = key.split('-W').map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7;
  const start = fromUtc(jan4 - (dow - 1) * DAY + (w - 1) * 7 * DAY);
  return { start, end: addDays(start, 6) };
}

export function shiftWeek(key, n) {
  return weekKey(addDays(weekRange(key).start, n * 7));
}

/* ------------------------------------------------------------ progresso */

export function courseProgress(course) {
  const total = course.modules.length;
  const done = course.modules.filter((m) => m.done).length;
  return { done, total, remaining: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function overallProgress(courses) {
  let done = 0;
  let total = 0;
  for (const c of courses) {
    const p = courseProgress(c);
    done += p.done;
    total += p.total;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function lastActivity(course, sessions) {
  const dates = [];
  if (course.startDate) dates.push(course.startDate);
  for (const m of course.modules) if (m.doneAt) dates.push(m.doneAt);
  for (const s of sessions) if (s.courseId === course.id) dates.push(s.date);
  if (!dates.length) return null;
  return dates.sort().at(-1);
}

/** Giorni di inattività se il corso è "in corso" e fermo da più di staleDays, altrimenti 0. */
export function staleDays(course, sessions, today, threshold = 7) {
  if (course.status !== 'in_corso') return 0;
  if (courseProgress(course).remaining === 0) return 0;
  const last = lastActivity(course, sessions);
  if (!last) return 0;
  const idle = diffDays(last, today);
  return idle > threshold ? idle : 0;
}

/**
 * Previsione di fine corso basata sul ritmo reale (moduli completati
 * nelle ultime 4 settimane, o dall'inizio se il corso è più giovane).
 */
export function forecast(course, today) {
  const { done, total, remaining } = courseProgress(course);
  if (!total) return { kind: 'no-modules' };
  if (!remaining) {
    const last = course.modules.map((m) => m.doneAt).filter(Boolean).sort().at(-1) || null;
    return { kind: 'done', date: last };
  }
  const doneDates = course.modules.filter((m) => m.done && m.doneAt).map((m) => m.doneAt);
  const start = course.startDate || doneDates.slice().sort()[0] || today;
  const elapsed = Math.max(1, diffDays(start, today) + 1);
  const windowDays = Math.min(28, elapsed);
  const from = addDays(today, -(windowDays - 1));
  const recent = doneDates.filter((d) => d >= from && d <= today).length;

  let perDay = 0;
  if (recent > 0) perDay = recent / windowDays;
  else if (done > 0) perDay = done / elapsed;

  const out = { kind: 'no-pace', remaining };
  if (perDay > 0) {
    out.kind = 'eta';
    out.eta = addDays(today, Math.ceil(remaining / perDay));
    out.perWeek = perDay * 7;
  }
  if (course.targetDate) {
    const daysLeft = diffDays(today, course.targetDate);
    out.target = course.targetDate;
    out.daysLeft = daysLeft;
    out.deadlinePassed = daysLeft < 0;
    if (out.eta) out.lateBy = diffDays(course.targetDate, out.eta); // >0 = in ritardo
    if (daysLeft >= 0) {
      out.requiredPerWeek = (remaining / Math.max(1, daysLeft + 1)) * 7;
      if (course.minutesPerLesson) out.requiredMinutesPerWeek = Math.round(out.requiredPerWeek * course.minutesPerLesson);
    }
  }
  return out;
}

/* ------------------------------------------------------------ costanza */

export function minutesByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!s.minutes) continue;
    map.set(s.date, (map.get(s.date) || 0) + Number(s.minutes));
  }
  return map;
}

export function streak(sessions, today) {
  const days = minutesByDay(sessions);
  let current = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const day of [...days.keys()].sort()) {
    run = prev && diffDays(prev, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  return { current, longest, activeToday: days.has(today) };
}

export function weeklyGoal(data, key) {
  const prev = data.reviews[shiftWeek(key, -1)];
  return {
    minutes: Number(prev?.nextMinutes) || data.settings.weeklyGoalMinutes,
    text: prev?.nextGoal || '',
  };
}

export function weekStats(data, key) {
  const { start, end } = weekRange(key);
  const inWeek = (d) => d && d >= start && d <= end;
  const sessions = data.sessions.filter((s) => inWeek(s.date));
  const minutes = sessions.reduce((a, s) => a + Number(s.minutes || 0), 0);
  const days = new Set(sessions.filter((s) => s.minutes > 0).map((s) => s.date)).size;
  const byCourse = new Map();
  for (const s of sessions) byCourse.set(s.courseId || '', (byCourse.get(s.courseId || '') || 0) + Number(s.minutes || 0));
  const modules = [];
  for (const c of data.courses) {
    for (const m of c.modules) if (m.done && inWeek(m.doneAt)) modules.push({ course: c, module: m });
  }
  modules.sort((a, b) => a.module.doneAt.localeCompare(b.module.doneAt));
  return { start, end, sessions, minutes, days, byCourse, modules };
}

/** Il prossimo modulo da fare (non solo il corso). */
export function nextAction(data, today) {
  const rank = { in_corso: 0, da_iniziare: 1 };
  const candidates = data.courses
    .filter((c) => c.status in rank && courseProgress(c).remaining > 0)
    .map((c) => ({ c, last: lastActivity(c, data.sessions) || '' }));
  candidates.sort((a, b) =>
    rank[a.c.status] - rank[b.c.status]
    || (a.c.targetDate || '9999').localeCompare(b.c.targetDate || '9999')
    || b.last.localeCompare(a.last));
  const top = candidates[0];
  if (!top) return null;
  const index = top.c.modules.findIndex((m) => !m.done);
  return { course: top.c, module: top.c.modules[index], index };
}

/* ------------------------------------------------------------ traguardi */

const STREAK_GOALS = [3, 10, 30, 100];

export function detectMilestones(data, today) {
  const out = [];
  if (data.sessions.some((s) => s.minutes > 0)) {
    out.push({ key: 'first-session', emoji: '🌱', title: 'Prima sessione registrata', text: 'Il primo passo è fatto. Da qui si costruisce.' });
  }
  for (const c of data.courses) {
    const p = courseProgress(c);
    if (p.done >= 1) out.push({ key: `first:${c.id}`, emoji: '✅', title: 'Primo modulo completato', text: `Hai rotto il ghiaccio con «${c.title}».` });
    if (p.total >= 2 && p.pct >= 50) out.push({ key: `half:${c.id}`, emoji: '⛰️', title: 'Metà strada!', text: `Sei al ${p.pct}% di «${c.title}». Il più è fatto.` });
    if (p.total && p.remaining === 0) out.push({ key: `done:${c.id}`, emoji: '🏆', title: 'Corso completato', text: `«${c.title}» è tuo. Aggiungilo al CV e a LinkedIn!` });
  }
  const { longest } = streak(data.sessions, today);
  for (const n of STREAK_GOALS) {
    if (longest >= n) out.push({ key: `streak:${n}`, emoji: '🔥', title: `${n} giorni di fila`, text: `Una streak di ${n} giorni consecutivi di studio. Costanza vera.` });
  }
  return out;
}

export function newMilestones(data, today) {
  const seen = new Set(data.milestones.map((m) => m.key));
  return detectMilestones(data, today).filter((m) => !seen.has(m.key));
}

/* ------------------------------------------------------------ merge */

function stamp(x) {
  return x?.updatedAt || '';
}

function mergeById(a = [], b = [], deleted) {
  const map = new Map();
  for (const item of [...b, ...a]) {
    if (deleted.has(item.id)) continue;
    const prev = map.get(item.id);
    if (!prev || stamp(item) >= stamp(prev)) map.set(item.id, item);
  }
  // mantiene l'ordine locale, poi aggiunge gli elementi solo remoti
  const order = [...a, ...b].map((x) => x.id);
  return [...new Set(order)].filter((id) => map.has(id)).map((id) => map.get(id));
}

/**
 * Unisce i dati locali con quelli già presenti nella repo, così le modifiche
 * fatte da telefono e da computer non si sovrascrivono a vicenda.
 */
export function mergeData(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const deleted = new Set([...(local.deleted || []), ...(remote.deleted || [])]);
  const reviews = { ...remote.reviews };
  for (const [k, v] of Object.entries(local.reviews || {})) {
    if (!reviews[k] || stamp(v) >= stamp(reviews[k])) reviews[k] = v;
  }
  const milestones = new Map();
  for (const m of [...(remote.milestones || []), ...(local.milestones || [])]) if (!milestones.has(m.key)) milestones.set(m.key, m);
  return {
    ...remote,
    ...local,
    settings: stamp(local.settings) >= stamp(remote.settings) ? local.settings : remote.settings,
    courses: mergeById(local.courses, remote.courses, deleted),
    sessions: mergeById(local.sessions, remote.sessions, deleted).sort((x, y) => x.date.localeCompare(y.date)),
    reviews,
    milestones: [...milestones.values()],
    deleted: [...deleted],
  };
}

export function mergeSwipe(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const deleted = new Set([...(local.deleted || []), ...(remote.deleted || [])]);
  return { ...remote, ...local, items: mergeById(local.items, remote.items, deleted), deleted: [...deleted] };
}
