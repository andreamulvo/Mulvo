import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../assets/js/logic.js';

const mod = (title, doneAt = null) => ({ id: `m-${title}`, title, done: Boolean(doneAt), doneAt, learned: '', ideaSent: false });

test('settimane ISO', () => {
  assert.equal(L.weekKey('2026-11-03'), '2026-W45');
  assert.equal(L.weekKey('2027-01-01'), '2026-W53');
  assert.deepEqual(L.weekRange('2026-W45'), { start: '2026-11-02', end: '2026-11-08' });
  assert.equal(L.shiftWeek('2026-W01', -1), '2025-W52');
  assert.equal(L.weekday('2026-11-08'), 6);
  assert.equal(L.diffDays('2026-03-28', '2026-03-30'), 2); // cambio ora legale
});

test('avanzamento calcolato dai moduli', () => {
  const c = { modules: [mod('a', '2026-10-01'), mod('b'), mod('c'), mod('d')] };
  assert.deepEqual(L.courseProgress(c), { done: 1, total: 4, remaining: 3, pct: 25 });
});

test('previsione: ritmo e confronto con la scadenza', () => {
  const c = {
    id: 'c1', status: 'in_corso', startDate: '2026-10-20', targetDate: '2026-11-10', minutesPerLesson: 20,
    modules: [mod('a', '2026-10-21'), mod('b', '2026-10-28'), mod('c'), mod('d'), mod('e'), mod('f')],
  };
  const f = L.forecast(c, '2026-11-02'); // 2 moduli in 14 giorni → 1/settimana
  assert.equal(f.kind, 'eta');
  assert.equal(f.eta, '2026-11-30');
  assert.equal(f.lateBy, 20);
  assert.ok(f.requiredPerWeek > 3);
  assert.equal(L.forecast({ ...c, modules: [mod('x')] }, '2026-11-02').kind, 'no-pace');
  assert.equal(L.forecast({ ...c, modules: [mod('x', '2026-10-30')] }, '2026-11-02').kind, 'done');
});

test('avviso corso fermo oltre 7 giorni', () => {
  const c = { id: 'c1', status: 'in_corso', startDate: '2026-10-01', modules: [mod('a', '2026-10-10'), mod('b')] };
  assert.equal(L.staleDays(c, [], '2026-10-17'), 0);
  assert.equal(L.staleDays(c, [], '2026-10-20'), 10);
  assert.equal(L.staleDays(c, [{ courseId: 'c1', date: '2026-10-19', minutes: 10 }], '2026-10-20'), 0);
  assert.equal(L.staleDays({ ...c, status: 'in_pausa' }, [], '2026-10-20'), 0);
});

test('streak', () => {
  const s = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-11'].map((date) => ({ date, minutes: 20 }));
  assert.deepEqual(L.streak(s, '2026-10-12'), { current: 2, longest: 3, activeToday: false });
  assert.equal(L.streak(s, '2026-10-13').current, 0);
});

test('prossima azione = primo modulo non fatto del corso più urgente', () => {
  const d = L.normalizeData({
    courses: [
      { id: 'a', status: 'in_corso', targetDate: '2026-12-31', modules: [mod('a1', '2026-10-01'), mod('a2')] },
      { id: 'b', status: 'in_corso', targetDate: '2026-11-30', modules: [mod('b1')] },
      { id: 'c', status: 'in_pausa', targetDate: '2026-11-01', modules: [mod('c1')] },
    ],
  });
  const n = L.nextAction(d, '2026-11-03');
  assert.equal(n.course.id, 'b');
  assert.equal(n.module.title, 'b1');
});

test('traguardi rilevati una sola volta', () => {
  const d = L.normalizeData({ courses: [{ id: 'a', title: 'A', status: 'in_corso', modules: [mod('1', '2026-10-01'), mod('2', '2026-10-02')] }] });
  const keys = L.newMilestones(d, '2026-10-02').map((m) => m.key);
  assert.deepEqual(keys, ['first:a', 'half:a', 'done:a']);
  d.milestones = keys.map((key) => ({ key }));
  assert.equal(L.newMilestones(d, '2026-10-02').length, 0);
});

test('obiettivo settimanale ereditato dalla revisione precedente', () => {
  const d = L.normalizeData({ reviews: { '2026-W44': { nextMinutes: 240, nextGoal: 'finire Meta Ads' } } });
  assert.deepEqual(L.weeklyGoal(d, '2026-W45'), { minutes: 240, text: 'finire Meta Ads' });
  assert.equal(L.weeklyGoal(d, '2026-W46').minutes, 180);
});

test('merge di modifiche da due dispositivi', () => {
  const base = L.normalizeData({ courses: [{ id: 'c', title: 'v1', updatedAt: '1', modules: [] }] });
  const phone = structuredClone(base);
  phone.sessions.push({ id: 's1', date: '2026-11-01', minutes: 30, updatedAt: '2' });
  const laptop = structuredClone(base);
  laptop.courses[0] = { ...laptop.courses[0], title: 'v2', updatedAt: '3' };
  laptop.sessions.push({ id: 's2', date: '2026-11-02', minutes: 15, updatedAt: '3' });
  laptop.deleted.push('s1');
  const m = L.mergeData(laptop, phone);
  assert.equal(m.courses[0].title, 'v2');
  assert.deepEqual(m.sessions.map((s) => s.id), ['s2']);
});
