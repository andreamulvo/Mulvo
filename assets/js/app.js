import * as L from './logic.js';
import {
  store, load, mutate, onChange, hasGithub, saveConfig, testConnection, sync,
  exportJSON, importJSON, resetLocal,
} from './store.js';

/* ================================================================ utilità */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => L.todayISO();
const touch = (o) => { o.updatedAt = new Date().toISOString(); return o; };
const getCourse = (id) => store.data.courses.find((c) => c.id === id);
const getModule = (c, id) => c?.modules.find((m) => m.id === id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function fmt(iso, opts = { day: 'numeric', month: 'short' }) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('it-IT', { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
const fmtLong = (iso) => fmt(iso, { day: 'numeric', month: 'long', year: 'numeric' });
function fmtMin(m) {
  m = Math.round(Number(m) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
const round1 = (n) => (Math.round(n * 10) / 10).toLocaleString('it-IT');

function bar(pct, cls = '') {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="bar ${cls}" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;
}

function toast(html, ms = 3200) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

/* ================================================================ mutazioni */

function change(fn, label) {
  mutate('data', fn, label);
  celebrateNew();
  render();
}

function celebrateNew() {
  const fresh = L.newMilestones(store.data, today());
  if (!fresh.length) return;
  mutate('data', (d) => {
    for (const m of fresh) d.milestones.push({ key: m.key, date: today(), emoji: m.emoji, title: m.title, text: m.text });
  }, 'traguardo raggiunto');
  showCelebration(fresh);
}

function setModuleDone(c, m, done, date = today()) {
  m.done = done;
  m.doneAt = done ? date : null;
  if (done && c.status === 'da_iniziare') {
    c.status = 'in_corso';
    if (!c.startDate) c.startDate = date;
  }
  const p = L.courseProgress(c);
  if (p.total && !p.remaining) c.status = 'completato';
  else if (!done && c.status === 'completato') c.status = 'in_corso';
  touch(c);
}

/* ================================================================ componenti */

function statusPill(status) {
  return `<span class="pill pill-${status}">${L.STATUSES[status] || status}</span>`;
}

function forecastHTML(c, short = false) {
  const f = L.forecast(c, today());
  if (f.kind === 'no-modules') return '<p class="muted">Aggiungi i moduli per vedere la previsione.</p>';
  if (f.kind === 'done') return `<p class="ok">🏆 Completato${f.date ? ` il ${fmtLong(f.date)}` : ''}.</p>`;
  if (c.status === 'in_pausa') return '<p class="muted">In pausa: la previsione riparte quando riprendi.</p>';
  const lines = [];
  if (f.kind === 'eta') {
    lines.push(`A questo ritmo finisci il <strong>${fmtLong(f.eta)}</strong>`);
  } else {
    lines.push('Completa il primo modulo per stimare quando finirai.');
  }
  if (f.target) {
    if (f.deadlinePassed) {
      lines.push(`<span class="warn">La scadenza del ${fmtLong(f.target)} è passata: fissane una nuova realistica.</span>`);
    } else if (f.lateBy > 0) {
      lines.push(`<span class="warn">${plural(f.lateBy, 'giorno', 'giorni')} dopo la tua scadenza (${fmt(f.target)}).</span>`);
    } else if (f.lateBy !== undefined) {
      lines.push(`<span class="ok">${f.lateBy < 0 ? `In anticipo di ${plural(-f.lateBy, 'giorno', 'giorni')}` : 'Esattamente in linea'} sulla scadenza (${fmt(f.target)}).</span>`);
    } else {
      lines.push(`Scadenza: ${fmtLong(f.target)}.`);
    }
  }
  if (!short) {
    if (f.perWeek) lines.push(`<span class="muted">Ritmo attuale: ${round1(f.perWeek)} moduli/settimana.</span>`);
    if (f.requiredPerWeek && (f.kind !== 'eta' || f.lateBy > 0)) {
      lines.push(`Per arrivarci servono ~<strong>${round1(f.requiredPerWeek)} moduli/settimana</strong>${f.requiredMinutesPerWeek ? ` (≈ ${fmtMin(f.requiredMinutesPerWeek)})` : ''}.`);
    }
  }
  return lines.map((l) => `<p>${l}</p>`).join('');
}

function staleHTML(c) {
  const idle = L.staleDays(c, store.data.sessions, today(), store.data.settings.staleDays);
  if (!idle) return '';
  const next = c.modules.find((m) => !m.done);
  return `<div class="nudge">
    <span aria-hidden="true">🌤️</span>
    <p><strong>«${esc(c.title)}» ti aspetta da ${idle} giorni.</strong> Nessun senso di colpa: bastano 15 minuti per ripartire${next ? ` con «${esc(next.title)}»` : ''}.</p>
    <button class="btn btn-small" data-action="open-session" data-course="${c.id}" data-module="${next?.id || ''}">Riparto ora</button>
  </div>`;
}

function heatmap(weeks = 53) {
  const end = today();
  const lastWeekStart = L.startOfWeek(end);
  const start = L.addDays(lastWeekStart, -(weeks - 1) * 7);
  const mins = L.minutesByDay(store.data.sessions);
  const level = (m) => (!m ? 0 : m <= 20 ? 1 : m <= 40 ? 2 : m <= 75 ? 3 : 4);
  const cells = [];
  const months = [];
  let prevMonth = null;
  for (let w = 0; w < weeks; w++) {
    const ws = L.addDays(start, w * 7);
    const month = ws.slice(0, 7);
    if (month !== prevMonth) {
      if (prevMonth !== null || Number(ws.slice(8)) <= 7) months.push(`<span style="grid-column:${w + 1}">${fmt(ws, { month: 'short' })}</span>`);
      prevMonth = month;
    }
    for (let d = 0; d < 7; d++) {
      const day = L.addDays(ws, d);
      if (day > end) { cells.push('<i class="future"></i>'); continue; }
      const m = mins.get(day) || 0;
      cells.push(`<i class="l${level(m)}${day === end ? ' today' : ''}" title="${fmt(day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${m ? fmtMin(m) : 'nessuno studio'}"></i>`);
    }
  }
  return `<div class="heatmap-wrap"><div class="heatmap" style="--weeks:${weeks}">
      <div class="hm-months">${months.join('')}</div>
      <div class="hm-days"><span>L</span><span></span><span>M</span><span></span><span>V</span><span></span><span>D</span></div>
      <div class="hm-grid">${cells.join('')}</div>
    </div></div>
    <div class="hm-legend">Meno <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> Più</div>`;
}

function emptyCourses() {
  return `<div class="empty">
    <p class="empty-emoji" aria-hidden="true">📚</p>
    <h2>Nessun corso ancora</h2>
    <p>Aggiungi il primo corso con i suoi moduli: da lì in poi qui troverai sempre il prossimo passo da fare.</p>
    <a class="btn" href="#/nuovo-corso">+ Aggiungi un corso</a>
  </div>`;
}

/* ================================================================ viste */

const VIEWS = {};

VIEWS.home = () => {
  const d = store.data;
  const t = today();
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const wk = L.weekKey(t);
  const stats = L.weekStats(d, wk);
  const goal = L.weeklyGoal(d, wk);
  const st = L.streak(d.sessions, t);
  const overall = L.overallProgress(d.courses);
  const next = L.nextAction(d, t);
  const active = d.courses.filter((c) => c.status === 'in_corso');
  const daysLeft = 6 - L.weekday(t);
  const missing = Math.max(0, goal.minutes - stats.minutes);

  let banner = '';
  const lastWeek = L.shiftWeek(wk, -1);
  if (L.weekday(t) === 6 && !d.reviews[wk]) {
    banner = `<a class="banner" href="#/revisione/${wk}"><span aria-hidden="true">🗓️</span><span><strong>È domenica: tempo di revisione.</strong> Cinque minuti per guardare la settimana e fissare la prossima.</span><span aria-hidden="true">→</span></a>`;
  } else if (L.weekday(t) <= 1 && !d.reviews[lastWeek] && L.weekStats(d, lastWeek).sessions.length) {
    banner = `<a class="banner" href="#/revisione/${lastWeek}"><span aria-hidden="true">🗓️</span><span><strong>Revisione della settimana scorsa da fare.</strong> Recuperala ora, ci vogliono pochi minuti.</span><span aria-hidden="true">→</span></a>`;
  }

  const nextCard = next ? `
    <article class="card next-action">
      <p class="eyebrow">Prossima azione</p>
      <h2>${esc(next.module.title)}</h2>
      <p class="muted">Modulo ${next.index + 1} di ${next.course.modules.length} · <a href="#/corso/${next.course.id}">${esc(next.course.title)}</a>${next.course.minutesPerLesson ? ` · ~${next.course.minutesPerLesson} min` : ''}</p>
      ${next.course.why ? `<blockquote class="why small">${esc(next.course.why)}</blockquote>` : ''}
      <div class="actions">
        <button class="btn" data-action="open-session" data-course="${next.course.id}" data-module="${next.module.id}" data-complete="1">Fatto: registra e spunta ✓</button>
        <button class="btn btn-ghost" data-action="open-session" data-course="${next.course.id}" data-module="${next.module.id}">Solo sessione</button>
      </div>
    </article>` : d.courses.length ? `
    <article class="card next-action">
      <p class="eyebrow">Prossima azione</p>
      <h2>Nessun modulo in sospeso 🎉</h2>
      <p class="muted">Tutti i corsi attivi sono completati o in pausa. Scegli il prossimo da iniziare.</p>
      <div class="actions"><a class="btn" href="#/nuovo-corso">+ Nuovo corso</a><a class="btn btn-ghost" href="#/corsi">Vedi corsi</a></div>
    </article>` : `<article class="card next-action">${emptyCourses()}</article>`;

  const milestones = d.milestones.slice(-4).reverse();

  return `
    <header class="page-head">
      <p class="eyebrow">${fmt(t, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1>${hello}! ${st.activeToday ? 'Oggi hai già studiato 💪' : st.current ? 'Teniamo viva la streak?' : 'Pronto per un pezzetto di studio?'}</h1>
    </header>
    ${banner}
    <div class="home-grid">
      ${nextCard}
      <div class="stat-stack">
        <article class="card stat">
          <div class="stat-top"><span class="stat-icon" aria-hidden="true">🔥</span><div><p class="stat-num">${st.current}</p><p class="stat-label">${st.current === 1 ? 'giorno di fila' : 'giorni di fila'}</p></div></div>
          <p class="muted small">${st.current && !st.activeToday ? 'Studia oggi per non interromperla.' : st.activeToday ? 'Streak al sicuro per oggi.' : 'Una sessione oggi la fa ripartire.'} Record: ${st.longest}.</p>
        </article>
        <article class="card stat">
          <p class="stat-label">Questa settimana</p>
          <p class="stat-num">${fmtMin(stats.minutes)} <span class="stat-of">/ ${fmtMin(goal.minutes)}</span></p>
          ${bar((stats.minutes / goal.minutes) * 100, stats.minutes >= goal.minutes ? 'bar-ok' : '')}
          <p class="muted small">${missing ? `Mancano ${fmtMin(missing)} · ${daysLeft ? plural(daysLeft + 1, 'giorno', 'giorni') + ' compreso oggi' : 'ultimo giorno'}` : 'Obiettivo settimanale raggiunto! 🎯'}</p>
          ${goal.text ? `<p class="small goal-text">🎯 ${esc(goal.text)}</p>` : ''}
        </article>
        <article class="card stat">
          <p class="stat-label">Avanzamento complessivo</p>
          <p class="stat-num">${overall.pct}%</p>
          ${bar(overall.pct)}
          <p class="muted small">${overall.done}/${overall.total} moduli · ${plural(active.length, 'corso attivo', 'corsi attivi')}</p>
        </article>
      </div>
    </div>

    ${d.courses.map(staleHTML).join('')}

    ${active.length ? `
    <section class="section">
      <div class="section-head"><h2>In corso</h2><a href="#/corsi">Tutti i corsi →</a></div>
      <div class="mini-list">
        ${active.map((c) => { const p = L.courseProgress(c); return `
          <a class="card mini-course" href="#/corso/${c.id}">
            <div class="mini-top"><strong>${esc(c.title)}</strong><span class="muted small">${p.done}/${p.total} · ${p.pct}%</span></div>
            ${bar(p.pct)}
            <div class="small forecast">${forecastHTML(c, true)}</div>
          </a>`; }).join('')}
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Calendario di studio</h2><a href="#/sessioni">Sessioni →</a></div>
      <div class="card">${heatmap(26)}</div>
    </section>

    ${milestones.length ? `
    <section class="section">
      <div class="section-head"><h2>Traguardi</h2></div>
      <div class="milestones">
        ${milestones.map((m) => `<div class="card milestone"><span aria-hidden="true">${m.emoji || '⭐'}</span><div><strong>${esc(m.title)}</strong><p class="muted small">${esc(m.text || '')} · ${fmt(m.date)}</p></div></div>`).join('')}
      </div>
    </section>` : ''}
  `;
};

let courseFilter = 'attivi';
VIEWS.corsi = () => {
  const d = store.data;
  const filters = { attivi: 'Attivi', tutti: 'Tutti', ...L.STATUSES };
  const list = d.courses.filter((c) => {
    if (courseFilter === 'tutti') return true;
    if (courseFilter === 'attivi') return c.status === 'in_corso' || c.status === 'da_iniziare';
    return c.status === courseFilter;
  });
  return `
    <header class="page-head row">
      <div><p class="eyebrow">Formazione</p><h1>Corsi</h1></div>
      <a class="btn" href="#/nuovo-corso">+ Nuovo corso</a>
    </header>
    ${d.courses.length ? `
      <div class="chips" role="tablist">
        ${Object.entries(filters).map(([k, v]) => `<button class="chip${courseFilter === k ? ' on' : ''}" data-action="filter-courses" data-value="${k}" role="tab" aria-selected="${courseFilter === k}">${v} <span>${k === 'tutti' ? d.courses.length : k === 'attivi' ? d.courses.filter((c) => c.status === 'in_corso' || c.status === 'da_iniziare').length : d.courses.filter((c) => c.status === k).length}</span></button>`).join('')}
      </div>
      <div class="course-grid">
        ${list.map((c) => { const p = L.courseProgress(c); return `
          <a class="card course-card" href="#/corso/${c.id}">
            <div class="course-top">${c.category ? `<span class="tag">${esc(c.category)}</span>` : '<span></span>'}${statusPill(c.status)}</div>
            <h3>${esc(c.title)}</h3>
            ${c.platform ? `<p class="muted small">${esc(c.platform)}</p>` : ''}
            ${bar(p.pct, p.remaining === 0 && p.total ? 'bar-ok' : '')}
            <p class="small"><strong>${p.pct}%</strong> · ${p.done}/${p.total} moduli</p>
            <div class="small forecast">${forecastHTML(c, true)}</div>
            ${L.staleDays(c, d.sessions, today(), d.settings.staleDays) ? `<p class="small warn">Fermo da ${L.staleDays(c, d.sessions, today(), d.settings.staleDays)} giorni</p>` : ''}
          </a>`; }).join('') || '<p class="muted">Nessun corso in questo stato.</p>'}
      </div>` : emptyCourses()}
  `;
};

VIEWS.corso = (id) => {
  const c = getCourse(id);
  if (!c) return '<p>Corso non trovato. <a href="#/corsi">Torna ai corsi</a></p>';
  const d = store.data;
  const p = L.courseProgress(c);
  const sessions = d.sessions.filter((s) => s.courseId === c.id);
  const studied = sessions.reduce((a, s) => a + Number(s.minutes || 0), 0);
  const nextIdx = c.modules.findIndex((m) => !m.done);
  return `
    <a class="back" href="#/corsi">← Corsi</a>
    <header class="page-head course-head">
      <div class="course-top">
        <div class="tags">${c.category ? `<span class="tag">${esc(c.category)}</span>` : ''}${c.platform ? `<span class="muted small">${esc(c.platform)}</span>` : ''}${c.url ? `<a class="small" href="${esc(c.url)}" target="_blank" rel="noopener">Apri il corso ↗</a>` : ''}</div>
        <label class="status-select"><span class="sr-only">Stato</span>
          <select data-change="course-status" data-course="${c.id}">
            ${Object.entries(L.STATUSES).map(([k, v]) => `<option value="${k}"${c.status === k ? ' selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
      </div>
      <h1>${esc(c.title)}</h1>
    </header>

    ${c.why ? `<blockquote class="why"><span class="why-label">Perché lo sto facendo</span>${esc(c.why)}</blockquote>` : `<a class="why why-empty" href="#/modifica/${c.id}"><span class="why-label">Perché lo sto facendo</span>Scrivi in una frase perché stai facendo questo corso: ti servirà nei giorni di poca voglia.</a>`}

    ${staleHTML(c)}

    <div class="detail-grid">
      <article class="card">
        <p class="stat-label">Avanzamento</p>
        <p class="stat-num">${p.pct}%</p>
        ${bar(p.pct, p.remaining === 0 && p.total ? 'bar-ok' : '')}
        <p class="muted small">${p.done}/${p.total} moduli${c.minutesPerLesson && p.remaining ? ` · restano ≈ ${fmtMin(p.remaining * c.minutesPerLesson)}` : ''}</p>
      </article>
      <article class="card forecast">
        <p class="stat-label">Previsione</p>
        ${forecastHTML(c)}
      </article>
      <article class="card">
        <p class="stat-label">Dettagli</p>
        <dl class="facts">
          <dt>Inizio</dt><dd>${fmtLong(c.startDate)}</dd>
          <dt>Scadenza</dt><dd>${fmtLong(c.targetDate)}</dd>
          <dt>Per lezione</dt><dd>${c.minutesPerLesson ? `~${c.minutesPerLesson} min` : '—'}</dd>
          <dt>Studiato</dt><dd>${fmtMin(studied)} in ${plural(sessions.length, 'sessione', 'sessioni')}</dd>
        </dl>
      </article>
    </div>

    <div class="actions">
      <button class="btn" data-action="open-session" data-course="${c.id}" data-module="${c.modules[nextIdx]?.id || ''}">+ Registra sessione</button>
      <a class="btn btn-ghost" href="#/modifica/${c.id}">Modifica</a>
      <button class="btn btn-ghost btn-danger" data-action="delete-course" data-course="${c.id}">Elimina</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Moduli</h2><span class="muted small">Spunta quando completi: la percentuale si aggiorna da sola</span></div>
      <ol class="modules">
        ${c.modules.map((m, i) => `
          <li class="module${m.done ? ' done' : ''}${i === nextIdx ? ' next' : ''}" data-module="${m.id}">
            <div class="module-row">
              <label class="check">
                <input type="checkbox" data-action="toggle-module" data-course="${c.id}" data-module="${m.id}"${m.done ? ' checked' : ''}>
                <span class="module-title"><span class="module-n">${i + 1}.</span> ${esc(m.title)}</span>
              </label>
              ${i === nextIdx ? '<span class="pill pill-next">Prossimo</span>' : ''}
              ${m.doneAt ? `<span class="muted small">${fmt(m.doneAt)}</span>` : ''}
              <div class="module-tools">
                <button class="icon-btn" data-action="move-module" data-course="${c.id}" data-module="${m.id}" data-dir="-1" aria-label="Sposta su"${i === 0 ? ' disabled' : ''}>↑</button>
                <button class="icon-btn" data-action="move-module" data-course="${c.id}" data-module="${m.id}" data-dir="1" aria-label="Sposta giù"${i === c.modules.length - 1 ? ' disabled' : ''}>↓</button>
                <button class="icon-btn" data-action="delete-module" data-course="${c.id}" data-module="${m.id}" aria-label="Elimina modulo">✕</button>
              </div>
            </div>
            ${m.done ? `
              <div class="learned">
                <label for="learned-${m.id}">Cosa ho imparato <span class="muted">(3 righe)</span></label>
                <textarea id="learned-${m.id}" rows="3" maxlength="600" data-input="learned" data-course="${c.id}" data-module="${m.id}" placeholder="1. …&#10;2. …&#10;3. …">${esc(m.learned)}</textarea>
                ${m.ideaSent
                  ? `<p class="small ok">💡 Già nello swipe file · <a href="#/idee">Vedi idee</a> · <button class="link" data-action="to-idea" data-course="${c.id}" data-module="${m.id}">Crea un'altra idea</button></p>`
                  : `<button class="btn btn-small btn-ghost" data-action="to-idea" data-course="${c.id}" data-module="${m.id}">💡 Trasforma in idea di contenuto</button>`}
              </div>` : ''}
          </li>`).join('')}
      </ol>
      <form class="inline-form" data-form="add-module" data-course="${c.id}">
        <label class="sr-only" for="new-module">Nuovo modulo</label>
        <input id="new-module" name="title" placeholder="Aggiungi un modulo o una lezione…" required>
        <button class="btn btn-ghost">Aggiungi</button>
      </form>
    </section>

    ${sessions.length ? `
    <section class="section">
      <div class="section-head"><h2>Ultime sessioni</h2><a href="#/sessioni">Tutte →</a></div>
      <ul class="session-list">${sessions.slice().reverse().slice(0, 6).map(sessionRow).join('')}</ul>
    </section>` : ''}
  `;
};

function courseForm(c) {
  const isNew = !c;
  c = c || { title: '', platform: '', url: '', category: '', why: '', startDate: today(), targetDate: '', minutesPerLesson: '', status: 'da_iniziare', modules: [] };
  return `
    <a class="back" href="${isNew ? '#/corsi' : `#/corso/${c.id}`}">← Indietro</a>
    <header class="page-head"><p class="eyebrow">Formazione</p><h1>${isNew ? 'Nuovo corso' : 'Modifica corso'}</h1></header>
    <form class="card form" data-form="course" data-course="${c.id || ''}">
      <div class="field"><label for="f-title">Titolo *</label><input id="f-title" name="title" required value="${esc(c.title)}" placeholder="Es. Meta Ads da zero"></div>
      <div class="field-row">
        <div class="field"><label for="f-platform">Piattaforma</label><input id="f-platform" name="platform" value="${esc(c.platform)}" placeholder="Udemy, Coursera, YouTube…" list="platforms"></div>
        <div class="field"><label for="f-category">Categoria</label><input id="f-category" name="category" value="${esc(c.category)}" list="categories" placeholder="Social, Ads, UX/UI…"></div>
      </div>
      <datalist id="categories">${L.CATEGORIES.map((x) => `<option value="${x}">`).join('')}</datalist>
      <datalist id="platforms">${['Udemy', 'Coursera', 'LinkedIn Learning', 'Google Skillshop', 'Meta Blueprint', 'Domestika', 'YouTube', 'Interaction Design Foundation'].map((x) => `<option value="${x}">`).join('')}</datalist>
      <div class="field"><label for="f-url">Link</label><input id="f-url" name="url" type="url" value="${esc(c.url)}" placeholder="https://…"></div>
      <div class="field"><label for="f-why">Perché lo sto facendo</label><textarea id="f-why" name="why" rows="2" placeholder="Es. per candidarmi come SMM in-house con competenze UX">${esc(c.why)}</textarea><p class="hint">Una frase tua: comparirà in evidenza sul corso e nella prossima azione.</p></div>
      <div class="field-row three">
        <div class="field"><label for="f-start">Data inizio</label><input id="f-start" name="startDate" type="date" value="${esc(c.startDate || '')}"></div>
        <div class="field"><label for="f-target">Scadenza obiettivo</label><input id="f-target" name="targetDate" type="date" value="${esc(c.targetDate || '')}"></div>
        <div class="field"><label for="f-min">Minuti per lezione</label><input id="f-min" name="minutesPerLesson" type="number" min="1" inputmode="numeric" value="${esc(c.minutesPerLesson || '')}" placeholder="20"></div>
      </div>
      <div class="field"><label for="f-status">Stato</label>
        <select id="f-status" name="status">${Object.entries(L.STATUSES).map(([k, v]) => `<option value="${k}"${c.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="f-modules">Moduli / lezioni <span class="muted">(uno per riga)</span></label>
        <textarea id="f-modules" name="modules" rows="8" placeholder="Introduzione&#10;Struttura delle campagne&#10;Pubblico e targeting&#10;…">${esc(c.modules.map((m) => m.title).join('\n'))}</textarea>
        <p class="hint">${isNew ? 'Puoi incollare l’indice del corso. Potrai aggiungerne o riordinarli anche dopo.' : 'Le spunte e le note restano associate ai moduli con lo stesso nome.'}</p>
      </div>
      <div class="actions"><button class="btn">${isNew ? 'Crea corso' : 'Salva modifiche'}</button></div>
    </form>`;
}
VIEWS['nuovo-corso'] = () => courseForm(null);
VIEWS.modifica = (id) => courseForm(getCourse(id));

function sessionRow(s) {
  const c = getCourse(s.courseId);
  const m = getModule(c, s.moduleId);
  return `<li class="session">
    <span class="session-date">${fmt(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    <span class="session-what">${c ? `<a href="#/corso/${c.id}">${esc(c.title)}</a>` : '<span class="muted">Studio libero</span>'}${m ? ` <span class="muted">· ${esc(m.title)}</span>` : ''}${s.note ? `<br><span class="muted small">${esc(s.note)}</span>` : ''}</span>
    <strong class="session-min">${fmtMin(s.minutes)}</strong>
    <button class="icon-btn" data-action="delete-session" data-session="${s.id}" aria-label="Elimina sessione">✕</button>
  </li>`;
}

let showAllSessions = false;
VIEWS.sessioni = () => {
  const d = store.data;
  const t = today();
  const st = L.streak(d.sessions, t);
  const month = t.slice(0, 7);
  const monthMin = d.sessions.filter((s) => s.date.startsWith(month)).reduce((a, s) => a + Number(s.minutes || 0), 0);
  const total = d.sessions.reduce((a, s) => a + Number(s.minutes || 0), 0);
  const byWeek = new Map();
  for (const s of d.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''))) {
    const k = L.weekKey(s.date);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(s);
  }
  const weeks = [...byWeek.entries()];
  const shown = showAllSessions ? weeks : weeks.slice(0, 6);
  return `
    <header class="page-head row">
      <div><p class="eyebrow">Costanza</p><h1>Sessioni di studio</h1></div>
      <button class="btn" data-action="open-session">+ Registra sessione</button>
    </header>
    <div class="stat-row">
      <article class="card stat"><p class="stat-label">Streak attuale</p><p class="stat-num">🔥 ${st.current}</p><p class="muted small">Record: ${plural(st.longest, 'giorno', 'giorni')}</p></article>
      <article class="card stat"><p class="stat-label">Questo mese</p><p class="stat-num">${fmtMin(monthMin)}</p></article>
      <article class="card stat"><p class="stat-label">Totale</p><p class="stat-num">${fmtMin(total)}</p><p class="muted small">${plural(d.sessions.length, 'sessione', 'sessioni')}</p></article>
    </div>
    <section class="section"><div class="card">${heatmap(53)}</div></section>
    <section class="section">
      ${shown.length ? shown.map(([k, list]) => {
        const r = L.weekRange(k);
        const sum = list.reduce((a, s) => a + Number(s.minutes || 0), 0);
        return `<div class="section-head"><h2 class="h3">${fmt(r.start)} – ${fmt(r.end)}</h2><a class="small" href="#/revisione/${k}">${fmtMin(sum)} · revisione →</a></div>
          <ul class="session-list">${list.map(sessionRow).join('')}</ul>`;
      }).join('') : '<div class="empty"><p class="empty-emoji" aria-hidden="true">⏱️</p><h2>Ancora nessuna sessione</h2><p>Ogni volta che studi, anche 10 minuti, annotalo qui: il calendario si colora e la streak cresce.</p></div>'}
      ${weeks.length > 6 && !showAllSessions ? '<button class="btn btn-ghost" data-action="show-all-sessions">Mostra tutte le settimane</button>' : ''}
    </section>
  `;
};

function defaultReviewWeek() {
  const t = today();
  const cur = L.weekKey(t);
  if (L.weekday(t) >= 5) return cur;
  const prev = L.shiftWeek(cur, -1);
  return store.data.reviews[prev] ? cur : prev;
}

VIEWS.revisione = (key) => {
  const d = store.data;
  const wk = /^\d{4}-W\d{2}$/.test(key || '') ? key : defaultReviewWeek();
  const s = L.weekStats(d, wk);
  const goal = L.weeklyGoal(d, wk);
  const rev = d.reviews[wk] || {};
  const isCurrent = wk === L.weekKey(today());
  const isFuture = s.start > today();
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const day = L.addDays(s.start, i);
    return { day, min: s.sessions.filter((x) => x.date === day).reduce((a, x) => a + Number(x.minutes || 0), 0) };
  });
  const maxDay = Math.max(30, ...perDay.map((x) => x.min));
  const courseRows = [...s.byCourse.entries()].sort((a, b) => b[1] - a[1]);
  const nextGoal = L.weeklyGoal(d, L.shiftWeek(wk, 1));
  return `
    <header class="page-head">
      <p class="eyebrow">Revisione settimanale${isCurrent ? ' · settimana in corso' : ''}</p>
      <div class="week-nav">
        <a class="icon-btn" href="#/revisione/${L.shiftWeek(wk, -1)}" aria-label="Settimana precedente">‹</a>
        <h1>${fmt(s.start, { day: 'numeric', month: 'short' })} – ${fmt(s.end, { day: 'numeric', month: 'short', year: 'numeric' })}</h1>
        ${isCurrent || isFuture ? '<span class="icon-btn disabled" aria-hidden="true">›</span>' : `<a class="icon-btn" href="#/revisione/${L.shiftWeek(wk, 1)}" aria-label="Settimana successiva">›</a>`}
      </div>
    </header>

    <div class="stat-row four">
      <article class="card stat"><p class="stat-label">Minuti studiati</p><p class="stat-num">${fmtMin(s.minutes)}</p>${bar((s.minutes / goal.minutes) * 100, s.minutes >= goal.minutes ? 'bar-ok' : '')}<p class="muted small">Obiettivo ${fmtMin(goal.minutes)}${s.minutes >= goal.minutes ? ' · raggiunto 🎯' : ''}</p></article>
      <article class="card stat"><p class="stat-label">Giorni di studio</p><p class="stat-num">${s.days}<span class="stat-of">/7</span></p></article>
      <article class="card stat"><p class="stat-label">Sessioni</p><p class="stat-num">${s.sessions.length}</p></article>
      <article class="card stat"><p class="stat-label">Moduli completati</p><p class="stat-num">${s.modules.length}</p></article>
    </div>

    ${goal.text ? `<p class="goal-text card">🎯 L’obiettivo di questa settimana era: <strong>${esc(goal.text)}</strong></p>` : ''}

    <section class="section">
      <div class="review-grid">
        <article class="card">
          <h2 class="h3">Giorno per giorno</h2>
          <div class="week-bars">
            ${perDay.map((x) => `<div class="wb"><span class="wb-val">${x.min ? x.min : ''}</span><div class="wb-track"><span style="height:${(x.min / maxDay) * 100}%"></span></div><span class="wb-day${x.day === today() ? ' today' : ''}">${fmt(x.day, { weekday: 'narrow' })}</span></div>`).join('')}
          </div>
        </article>
        <article class="card">
          <h2 class="h3">Tempo per corso</h2>
          ${courseRows.length ? `<ul class="course-minutes">${courseRows.map(([id, min]) => `<li><span>${esc(getCourse(id)?.title || 'Studio libero')}</span><strong>${fmtMin(min)}</strong>${bar((min / s.minutes) * 100)}</li>`).join('')}</ul>` : '<p class="muted">Nessuna sessione registrata in questa settimana.</p>'}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>Cosa ho imparato</h2>
      ${s.modules.length ? `<ul class="learned-list">${s.modules.map(({ course: c, module: m }) => `
        <li class="card">
          <p class="small muted"><a href="#/corso/${c.id}">${esc(c.title)}</a> · ${fmt(m.doneAt, { weekday: 'short', day: 'numeric' })}</p>
          <strong>${esc(m.title)}</strong>
          ${m.learned ? `<p class="pre">${esc(m.learned)}</p>` : `<p class="muted small">Nessuna nota: <a href="#/corso/${c.id}">aggiungila</a> finché è fresca.</p>`}
          ${m.learned && !m.ideaSent ? `<button class="btn btn-small btn-ghost" data-action="to-idea" data-course="${c.id}" data-module="${m.id}">💡 Trasforma in idea di contenuto</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Nessun modulo completato in questa settimana.</p>'}
    </section>

    <section class="section">
      <form class="card form" data-form="review" data-week="${wk}">
        <h2>Chiusura della settimana</h2>
        <div class="field"><label for="r-notes">Com’è andata? Cosa ha funzionato, cosa no</label><textarea id="r-notes" name="notes" rows="3" placeholder="Es. studiare la mattina presto funziona, la sera no.">${esc(rev.notes || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="r-goal">Obiettivo della settimana prossima</label><input id="r-goal" name="nextGoal" value="${esc(rev.nextGoal || '')}" placeholder="Es. finire il modulo sul retargeting"></div>
          <div class="field"><label for="r-min">Minuti obiettivo</label><input id="r-min" name="nextMinutes" type="number" min="0" step="15" inputmode="numeric" value="${esc(rev.nextMinutes || nextGoal.minutes)}"></div>
        </div>
        <div class="actions"><button class="btn">${rev.updatedAt ? 'Aggiorna revisione' : 'Salva revisione'}</button>${rev.updatedAt ? `<span class="muted small">Salvata il ${fmt(rev.updatedAt.slice(0, 10))}</span>` : ''}</div>
      </form>
    </section>
  `;
};

let ideaFilter = 'tutte';
const IDEA_STATUS = { idea: 'Idea', bozza: 'In bozza', pubblicata: 'Pubblicata' };
const CHANNELS = ['LinkedIn', 'Instagram', 'TikTok', 'Threads', 'Newsletter', 'Blog', 'Altro'];

VIEWS.idee = () => {
  const items = store.swipe.items.slice().reverse().filter((x) => ideaFilter === 'tutte' || x.status === ideaFilter);
  return `
    <header class="page-head"><p class="eyebrow">Dal corso al contenuto</p><h1>Swipe file · Idee</h1>
      <p class="muted">Quello che studi diventa materiale per i tuoi social e per LinkedIn. Le idee arrivano dai moduli completati, oppure aggiungile a mano.</p></header>
    <details class="card add-idea">
      <summary>+ Aggiungi un’idea a mano</summary>
      <form class="form" data-form="idea">
        <div class="field"><label for="i-title">Titolo / hook</label><input id="i-title" name="title" required></div>
        <div class="field"><label for="i-body">Appunti</label><textarea id="i-body" name="body" rows="3"></textarea></div>
        <div class="field"><label for="i-channel">Canale</label><select id="i-channel" name="channel">${CHANNELS.map((x) => `<option>${x}</option>`).join('')}</select></div>
        <button class="btn">Aggiungi</button>
      </form>
    </details>
    <div class="chips">
      ${Object.entries({ tutte: 'Tutte', ...IDEA_STATUS }).map(([k, v]) => `<button class="chip${ideaFilter === k ? ' on' : ''}" data-action="filter-ideas" data-value="${k}">${v} <span>${k === 'tutte' ? store.swipe.items.length : store.swipe.items.filter((x) => x.status === k).length}</span></button>`).join('')}
    </div>
    <div class="idea-grid">
      ${items.map((x) => `
        <article class="card idea" data-idea="${x.id}">
          <input class="idea-title" data-change="idea-field" data-field="title" data-idea="${x.id}" value="${esc(x.title)}" aria-label="Titolo">
          ${x.source?.courseTitle ? `<p class="small muted">📚 ${esc(x.source.courseTitle)}${x.source.moduleTitle ? ` › ${esc(x.source.moduleTitle)}` : ''}</p>` : ''}
          <textarea rows="4" data-change="idea-field" data-field="body" data-idea="${x.id}" aria-label="Testo">${esc(x.body)}</textarea>
          ${x.hint ? `<p class="small hint">${esc(x.hint)}</p>` : ''}
          <div class="idea-meta">
            <select data-change="idea-field" data-field="channel" data-idea="${x.id}" aria-label="Canale">${CHANNELS.map((ch) => `<option${x.channel === ch ? ' selected' : ''}>${ch}</option>`).join('')}</select>
            <select data-change="idea-field" data-field="status" data-idea="${x.id}" aria-label="Stato">${Object.entries(IDEA_STATUS).map(([k, v]) => `<option value="${k}"${x.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            <button class="icon-btn" data-action="copy-idea" data-idea="${x.id}" aria-label="Copia testo" title="Copia">⧉</button>
            <button class="icon-btn" data-action="delete-idea" data-idea="${x.id}" aria-label="Elimina idea" title="Elimina">✕</button>
          </div>
        </article>`).join('') || '<div class="empty"><p class="empty-emoji" aria-hidden="true">💡</p><h2>Nessuna idea qui</h2><p>Completa un modulo, scrivi cosa hai imparato e premi «Trasforma in idea di contenuto».</p></div>'}
    </div>
  `;
};

VIEWS.impostazioni = () => {
  const s = store.data.settings;
  const c = store.cfg;
  return `
    <header class="page-head"><p class="eyebrow">Mulvo</p><h1>Impostazioni</h1></header>
    <form class="card form" data-form="settings">
      <h2>Obiettivi</h2>
      <div class="field-row">
        <div class="field"><label for="s-goal">Obiettivo settimanale (minuti)</label><input id="s-goal" name="weeklyGoalMinutes" type="number" min="15" step="15" inputmode="numeric" value="${s.weeklyGoalMinutes}"><p class="hint">${fmtMin(s.weeklyGoalMinutes)} a settimana. La revisione della domenica può fissarne uno diverso per la settimana dopo.</p></div>
        <div class="field"><label for="s-stale">Avvisami se un corso è fermo da più di (giorni)</label><input id="s-stale" name="staleDays" type="number" min="1" inputmode="numeric" value="${s.staleDays}"></div>
      </div>
      <button class="btn">Salva obiettivi</button>
    </form>

    <form class="card form section" data-form="github">
      <h2>Salvataggio nella repo GitHub</h2>
      <p class="muted small">Con un token, sessioni, spunte e idee vengono salvate come commit in <code>data/formazione.json</code> e <code>data/swipe.json</code>. Senza token restano su questo dispositivo (puoi sempre esportarle).</p>
      <div class="field-row three">
        <div class="field"><label for="g-owner">Utente / organizzazione</label><input id="g-owner" name="owner" value="${esc(c.owner)}" autocapitalize="off"></div>
        <div class="field"><label for="g-repo">Repository</label><input id="g-repo" name="repo" value="${esc(c.repo)}" autocapitalize="off"></div>
        <div class="field"><label for="g-branch">Branch</label><input id="g-branch" name="branch" value="${esc(c.branch)}" autocapitalize="off"></div>
      </div>
      <div class="field"><label for="g-token">Token personale (fine-grained)</label><input id="g-token" name="token" type="password" value="${esc(c.token)}" autocomplete="off" placeholder="github_pat_…"></div>
      <details class="hint"><summary>Come creare il token</summary>
        <ol><li>GitHub → Settings → Developer settings → Personal access tokens → <em>Fine-grained tokens</em> → Generate new token.</li>
        <li>Repository access: <em>Only select repositories</em> → questa repo.</li>
        <li>Permissions → Repository → <em>Contents: Read and write</em>.</li>
        <li>Incollalo qui su ogni dispositivo che usi (telefono compreso). Resta salvato solo nel browser di quel dispositivo.</li></ol>
      </details>
      <div class="actions"><button class="btn">Salva e collega</button><button type="button" class="btn btn-ghost" data-action="test-github">Prova connessione</button><button type="button" class="btn btn-ghost" data-action="sync-now">Sincronizza ora</button></div>
    </form>

    <section class="card form section">
      <h2>Backup</h2>
      <p class="muted small">Scarica i file JSON o importane uno (sostituisce i dati attuali).</p>
      <div class="actions">
        <button class="btn btn-ghost" data-action="export" data-key="data">Esporta formazione.json</button>
        <button class="btn btn-ghost" data-action="export" data-key="swipe">Esporta swipe.json</button>
        <label class="btn btn-ghost">Importa formazione.json<input type="file" accept="application/json,.json" data-change="import" data-key="data" hidden></label>
      </div>
      <div class="actions"><button class="btn btn-ghost btn-danger" data-action="reset-local">Ricarica dalla repo (scarta la cache locale)</button></div>
    </section>
  `;
};

/* ================================================================ dialog */

function openSessionDialog({ courseId = '', moduleId = '', complete = false } = {}) {
  const dlg = $('#session-dialog');
  const courses = store.data.courses.filter((c) => c.status !== 'completato' || c.id === courseId);
  if (!courseId) courseId = L.nextAction(store.data, today())?.course.id || '';
  const c = getCourse(courseId);
  if (c && !moduleId) moduleId = c.modules.find((m) => !m.done)?.id || '';
  const suggested = c?.minutesPerLesson || 25;
  dlg.innerHTML = `
    <form method="dialog" class="form" data-form="session">
      <div class="dialog-head"><h2>Registra sessione</h2><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Chiudi">✕</button></div>
      <div class="field-row">
        <div class="field"><label for="ss-date">Data</label><input id="ss-date" name="date" type="date" value="${today()}" max="${today()}" required></div>
        <div class="field"><label for="ss-min">Minuti</label><input id="ss-min" name="minutes" type="number" min="1" max="720" inputmode="numeric" value="${suggested}" required></div>
      </div>
      <div class="chips quick-min">${[15, 25, 30, 45, 60, 90].map((m) => `<button type="button" class="chip" data-action="quick-min" data-value="${m}">${m}′</button>`).join('')}</div>
      <div class="field"><label for="ss-course">Corso</label>
        <select id="ss-course" name="courseId" data-change="session-course">
          <option value="">Studio libero</option>
          ${courses.map((x) => `<option value="${x.id}"${x.id === courseId ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="ss-module-field">${moduleField(c, moduleId)}</div>
      <label class="check"><input type="checkbox" name="complete"${complete ? ' checked' : ''}> Ho completato questo modulo</label>
      <div class="field"><label for="ss-note">Nota <span class="muted">(facoltativa)</span></label><input id="ss-note" name="note" placeholder="Es. rivisto due volte la parte sul pixel"></div>
      <div class="actions"><button class="btn" value="save">Salva sessione</button></div>
    </form>`;
  dlg.showModal();
}

function moduleField(c, moduleId) {
  if (!c || !c.modules.length) return '<input type="hidden" name="moduleId" value="">';
  return `<label for="ss-module">Modulo</label>
    <select id="ss-module" name="moduleId">
      <option value="">— Nessuno in particolare —</option>
      ${c.modules.map((m, i) => `<option value="${m.id}"${m.id === moduleId ? ' selected' : ''}>${i + 1}. ${esc(m.title)}${m.done ? ' ✓' : ''}</option>`).join('')}
    </select>`;
}

function showCelebration(list) {
  const dlg = $('#celebrate-dialog');
  const top = list.find((m) => m.key.startsWith('done:')) || list.find((m) => m.key.startsWith('streak:')) || list.at(-1);
  const others = list.filter((m) => m !== top);
  const colors = ['var(--accent)', 'var(--ok)', 'var(--sun)', 'var(--pink)', 'var(--sky)'];
  const confetti = Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${colors[i % colors.length]};animation-delay:${(i % 9) * 0.07}s;--r:${(i * 47) % 360}deg"></i>`).join('');
  dlg.innerHTML = `
    <div class="confetti" aria-hidden="true">${confetti}</div>
    <div class="celebrate">
      <p class="celebrate-emoji" aria-hidden="true">${top.emoji}</p>
      <h2>${esc(top.title)}</h2>
      <p>${esc(top.text)}</p>
      ${others.length ? `<ul class="small muted">${others.map((m) => `<li>${m.emoji} ${esc(m.title)}</li>`).join('')}</ul>` : ''}
      <button class="btn" data-action="close-dialog" autofocus>Grande! Avanti</button>
    </div>`;
  if ($('#session-dialog').open) $('#session-dialog').close();
  dlg.showModal();
}

/* ================================================================ azioni */

const actions = {
  'open-session': (el) => openSessionDialog({ courseId: el.dataset.course, moduleId: el.dataset.module, complete: Boolean(el.dataset.complete) }),
  'close-dialog': (el) => el.closest('dialog').close(),
  'quick-min': (el) => { $('#ss-min').value = el.dataset.value; },
  'filter-courses': (el) => { courseFilter = el.dataset.value; render(); },
  'filter-ideas': (el) => { ideaFilter = el.dataset.value; render(); },
  'show-all-sessions': () => { showAllSessions = true; render(); },

  'toggle-module': (el) => {
    const c = getCourse(el.dataset.course);
    const m = getModule(c, el.dataset.module);
    change(() => setModuleDone(c, m, el.checked), `${el.checked ? 'completato' : 'riaperto'} «${m.title}»`);
    if (el.checked) {
      requestAnimationFrame(() => $(`#learned-${m.id}`)?.focus({ preventScroll: true }));
      if (!$('#celebrate-dialog').open) toast('Modulo completato ✓ Scrivi subito cosa hai imparato, finché è fresco.');
    }
  },
  'move-module': (el) => {
    const c = getCourse(el.dataset.course);
    const i = c.modules.findIndex((m) => m.id === el.dataset.module);
    const j = i + Number(el.dataset.dir);
    if (j < 0 || j >= c.modules.length) return;
    change(() => { [c.modules[i], c.modules[j]] = [c.modules[j], c.modules[i]]; touch(c); }, 'riordinati i moduli');
  },
  'delete-module': (el) => {
    const c = getCourse(el.dataset.course);
    const m = getModule(c, el.dataset.module);
    if (!confirm(`Eliminare il modulo «${m.title}»?`)) return;
    change(() => { c.modules = c.modules.filter((x) => x !== m); touch(c); }, `eliminato modulo «${m.title}»`);
  },
  'delete-course': (el) => {
    const c = getCourse(el.dataset.course);
    if (!confirm(`Eliminare il corso «${c.title}» con tutti i suoi moduli? Le sessioni restano nel registro.`)) return;
    change((d) => { d.courses = d.courses.filter((x) => x !== c); d.deleted.push(c.id); }, `eliminato corso «${c.title}»`);
    location.hash = '#/corsi';
  },
  'delete-session': (el) => {
    if (!confirm('Eliminare questa sessione?')) return;
    change((d) => { d.sessions = d.sessions.filter((s) => s.id !== el.dataset.session); d.deleted.push(el.dataset.session); }, 'eliminata sessione');
  },
  'to-idea': (el) => {
    const c = getCourse(el.dataset.course);
    const m = getModule(c, el.dataset.module);
    const ta = $(`#learned-${m.id}`);
    const learned = (ta ? ta.value : m.learned).trim();
    if (!learned) {
      toast('Scrivi prima cosa hai imparato: è il cuore dell’idea.');
      ta?.focus();
      return;
    }
    const id = L.uid('idea');
    mutate('swipe', (s) => {
      s.items.push(touch({
        id,
        createdAt: new Date().toISOString(),
        title: `Cosa ho imparato su «${m.title}»`,
        body: learned,
        hint: `Formati possibili: carosello «3 cose che ho imparato su ${m.title}», post LinkedIn in prima persona sul percorso con ${c.title}, oppure un errore comune da evitare.`,
        channel: 'LinkedIn',
        status: 'idea',
        source: { type: 'corso', courseId: c.id, moduleId: m.id, courseTitle: c.title, moduleTitle: m.title },
      }));
    }, `nuova idea da «${m.title}»`);
    change(() => { m.learned = learned; m.ideaSent = true; touch(c); }, `idea da «${m.title}»`);
    toast('💡 Idea aggiunta allo swipe file · <a href="#/idee">Apri</a>');
  },
  'copy-idea': async (el) => {
    const x = store.swipe.items.find((i) => i.id === el.dataset.idea);
    try {
      await navigator.clipboard.writeText(`${x.title}\n\n${x.body}`);
      toast('Testo copiato');
    } catch { toast('Copia non riuscita'); }
  },
  'delete-idea': (el) => {
    if (!confirm('Eliminare questa idea?')) return;
    mutate('swipe', (s) => { s.items = s.items.filter((i) => i.id !== el.dataset.idea); s.deleted.push(el.dataset.idea); }, 'eliminata idea');
    render();
  },
  'test-github': async () => {
    saveConfig(Object.fromEntries(new FormData($('[data-form="github"]'))));
    try { await testConnection(); toast('✓ Connessione riuscita: la repo è raggiungibile.'); } catch (e) { toast(`Connessione non riuscita: ${esc(e.message)}`, 6000); }
  },
  'sync-now': () => sync(),
  export: (el) => {
    const blob = new Blob([exportJSON(el.dataset.key)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = el.dataset.key === 'data' ? 'formazione.json' : 'swipe.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'reset-local': () => {
    if (!confirm('Scartare la copia locale e ricaricare i dati dalla repo? Le modifiche non ancora salvate andranno perse.')) return;
    resetLocal();
    location.reload();
  },
};

const forms = {
  session: (f) => {
    const v = Object.fromEntries(new FormData(f));
    const c = getCourse(v.courseId);
    const m = getModule(c, v.moduleId);
    const minutes = Number(v.minutes);
    change((d) => {
      d.sessions.push(touch({ id: L.uid('s'), date: v.date, minutes, courseId: c?.id || '', moduleId: m?.id || '', note: v.note.trim(), createdAt: new Date().toISOString() }));
      d.sessions.sort((a, b) => a.date.localeCompare(b.date));
      if (c) {
        if (c.status === 'da_iniziare' || c.status === 'in_pausa') { c.status = 'in_corso'; touch(c); }
        if (!c.startDate) { c.startDate = v.date; touch(c); }
        if (m && v.complete && !m.done) setModuleDone(c, m, true, v.date);
      }
    }, `sessione ${minutes} min${c ? ` su «${c.title}»` : ''}`);
    $('#session-dialog').close();
    const st = L.streak(store.data.sessions, today());
    if (!$('#celebrate-dialog').open) toast(`Sessione salvata: ${fmtMin(minutes)} ${st.current > 1 ? `· 🔥 ${st.current} giorni di fila` : '· ben fatto!'}`);
  },
  course: (f) => {
    const v = Object.fromEntries(new FormData(f));
    const lines = v.modules.split('\n').map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    const fields = {
      title: v.title.trim(), platform: v.platform.trim(), url: v.url.trim(), category: v.category.trim(), why: v.why.trim(),
      startDate: v.startDate, targetDate: v.targetDate, minutesPerLesson: Number(v.minutesPerLesson) || null, status: v.status,
    };
    let id = f.dataset.course;
    if (!id) {
      id = L.uid('c');
      change((d) => {
        d.courses.push(touch({ id, ...fields, createdAt: new Date().toISOString(), modules: lines.map((title) => ({ id: L.uid('m'), title, done: false, doneAt: null, learned: '', ideaSent: false })) }));
      }, `nuovo corso «${fields.title}»`);
    } else {
      const c = getCourse(id);
      change(() => {
        const pool = c.modules.slice();
        const take = (pred) => { const i = pool.findIndex(pred); return i < 0 ? null : pool.splice(i, 1)[0]; };
        const matched = lines.map((title) => take((m) => m.title === title));
        // righe rinominate: riusa il modulo che stava nella stessa posizione
        const modules = lines.map((title, i) => {
          if (matched[i]) return matched[i];
          const old = c.modules[i] && pool.includes(c.modules[i]) ? take((m) => m === c.modules[i]) : null;
          return old ? { ...old, title } : { id: L.uid('m'), title, done: false, doneAt: null, learned: '', ideaSent: false };
        });
        Object.assign(c, fields, { modules });
        const p = L.courseProgress(c);
        if (p.total && !p.remaining) c.status = 'completato';
        touch(c);
      }, `modificato «${fields.title}»`);
    }
    location.hash = `#/corso/${id}`;
  },
  'add-module': (f) => {
    const c = getCourse(f.dataset.course);
    const title = new FormData(f).get('title').trim();
    if (!title) return;
    change(() => {
      c.modules.push({ id: L.uid('m'), title, done: false, doneAt: null, learned: '', ideaSent: false });
      if (c.status === 'completato') c.status = 'in_corso';
      touch(c);
    }, `nuovo modulo «${title}»`);
    $('#new-module')?.focus();
  },
  review: (f) => {
    const v = Object.fromEntries(new FormData(f));
    const wk = f.dataset.week;
    change((d) => {
      d.reviews[wk] = touch({ notes: v.notes.trim(), nextGoal: v.nextGoal.trim(), nextMinutes: Number(v.nextMinutes) || d.settings.weeklyGoalMinutes });
    }, `revisione ${wk}`);
    toast('Revisione salvata. Buona settimana! 🌱');
  },
  idea: (f) => {
    const v = Object.fromEntries(new FormData(f));
    mutate('swipe', (s) => s.items.push(touch({ id: L.uid('idea'), createdAt: new Date().toISOString(), title: v.title.trim(), body: v.body.trim(), channel: v.channel, status: 'idea', source: { type: 'manuale' } })), 'nuova idea');
    render();
  },
  settings: (f) => {
    const v = Object.fromEntries(new FormData(f));
    change((d) => {
      d.settings = touch({ ...d.settings, weeklyGoalMinutes: Number(v.weeklyGoalMinutes) || 180, staleDays: Number(v.staleDays) || 7 });
    }, 'impostazioni');
    toast('Obiettivi salvati');
  },
  github: async (f) => {
    saveConfig(Object.fromEntries(new FormData(f)));
    toast('Configurazione salvata. Ricarico i dati dalla repo…');
    await load();
    render();
  },
};

const changes = {
  'course-status': (el) => {
    const c = getCourse(el.dataset.course);
    change(() => { c.status = el.value; if (el.value === 'in_corso' && !c.startDate) c.startDate = today(); touch(c); }, `«${c.title}» → ${L.STATUSES[el.value]}`);
  },
  'session-course': (el) => {
    const c = getCourse(el.value);
    $('#ss-module-field').innerHTML = moduleField(c, c?.modules.find((m) => !m.done)?.id);
    if (c?.minutesPerLesson) $('#ss-min').value = c.minutesPerLesson;
  },
  'idea-field': (el) => {
    const x = store.swipe.items.find((i) => i.id === el.dataset.idea);
    mutate('swipe', () => { x[el.dataset.field] = el.value; touch(x); }, 'idea aggiornata');
    if (el.tagName === 'SELECT' && el.dataset.field === 'status' && ideaFilter !== 'tutte') render();
  },
  import: async (el) => {
    const file = el.files[0];
    if (!file) return;
    try {
      importJSON(el.dataset.key, await file.text());
      toast('Dati importati');
      render();
    } catch (e) { toast(`File non valido: ${esc(e.message)}`); }
  },
};

const inputTimers = new Map();
function onLearnedInput(el) {
  clearTimeout(inputTimers.get(el.id));
  inputTimers.set(el.id, setTimeout(() => {
    const c = getCourse(el.dataset.course);
    const m = getModule(c, el.dataset.module);
    if (!m || m.learned === el.value) return;
    mutate('data', () => { m.learned = el.value; touch(c); }, `appunti su «${m.title}»`);
  }, 600));
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.type !== 'checkbox') e.preventDefault();
  fn(el, e);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f || !forms[f.dataset.form]) return;
  e.preventDefault();
  forms[f.dataset.form](f);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'learned') onLearnedInput(e.target);
});
for (const dlg of $$('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

/* ================================================================ render */

function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : undefined };
}

const NAV_OF = { corso: 'corsi', 'nuovo-corso': 'corsi', modifica: 'corsi' };

function render() {
  const r = route();
  const view = VIEWS[r.name] || VIEWS.home;
  $('#view').innerHTML = view(r.arg);
  const active = NAV_OF[r.name] || (VIEWS[r.name] ? r.name : 'home');
  for (const a of $$('[data-nav]')) a.toggleAttribute('aria-current', a.dataset.nav === active);
  for (const w of $$('.heatmap-wrap')) w.scrollLeft = w.scrollWidth;
  renderStatus();
}

function renderStatus() {
  const el = $('#sync');
  const { state, message } = store.status;
  const map = {
    idle: ['', ''],
    local: ['local', 'Solo su questo dispositivo'],
    pending: ['busy', 'Modifiche da salvare…'],
    saving: ['busy', 'Salvataggio…'],
    saved: ['ok', 'Salvato nella repo'],
    error: ['err', 'Errore di salvataggio'],
  };
  const [cls, label] = map[state] || map.idle;
  el.className = `sync ${cls}`;
  el.textContent = label;
  el.title = message || label;
  el.hidden = !label;
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
onChange(renderStatus);
window.addEventListener('online', () => sync());
window.addEventListener('beforeunload', (e) => {
  if (store.status.state === 'pending' || store.status.state === 'saving') { sync(); e.preventDefault(); }
});

(async function init() {
  $('#view').innerHTML = '<p class="muted loading">Carico i tuoi dati…</p>';
  await load();
  celebrateNew();
  render();
})();
