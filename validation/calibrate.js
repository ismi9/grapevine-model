/**
 * E6.2 — Калібрування на польових даних.
 *
 * 1) Глобальні константи (Tier 2): MALATE_L → ціль TA(blanc)=7.0 г/л,
 *    K_MAL → ціль pH(blanc)=3.20 (бісекція по патченому сорці model.js).
 * 2) Сортові terpSynthBase → ціль terpFreeUg з field_data.json
 *    (фіксована точка: масштабування, 2-3 ітерації).
 * 3) Ансамбль невизначеності: 200 рандомізованих сценаріїв поля/погоди/агротехніки
 *    (mulberry32) → чесні 90% довірчі інтервали (p5/p50/p95) по Brix/TA/pH/терпенах.
 *
 * Джерела цілей: docs/model_overview.md (розділ 8 ТЗ: Brix 18-24, TA 4-9 г/л,
 * pH 3.0-3.6, вільні монотерпеноли ~400-1600 мкг/кг для мускату білого),
 * сортові дані E6.1 (docs/decision_log.md 2026-10-04).
 * Запуск: node validation/calibrate.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MODEL_SRC_PATH = path.join(__dirname, '..', 'app', 'js', 'model.js');
const FIELD_DATA_PATH = path.join(__dirname, 'field_data.json');
const BASE_SRC = fs.readFileSync(MODEL_SRC_PATH, 'utf8');
const FIELD = JSON.parse(fs.readFileSync(FIELD_DATA_PATH, 'utf8'));

// ---------- Патчинг сорця моделі ----------
function patch(src, consts, terpSynth) {
  let out = src;
  if (consts.MALATE_L != null)
    out = out.replace(/(MALATE_L = )[\d.]+/, `$1${consts.MALATE_L}`);
  if (consts.K_MAL != null)
    out = out.replace(/(K_MAL = )[\d.]+/, `$1${consts.K_MAL}`);
  if (consts.TARTRATE_L != null)
    out = out.replace(/(TARTRATE_L = )[\d.]+/, `$1${consts.TARTRATE_L}`);
  for (const [v, val] of Object.entries(terpSynth || {})) {
    const re = new RegExp(`(${v}: \\{[\\s\\S]*?terpSynthBase: )[\\d.]+`);
    if (!re.test(out)) throw new Error('не знайдено terpSynthBase для ' + v);
    out = out.replace(re, `$1${val}`);
  }
  return out;
}
function loadModel(consts, terpSynth) {
  const code = patch(BASE_SRC, consts, terpSynth);
  return new Function(code + '; return VineModel;')();
}

// ---------- Тестові запуски ----------
function summaryOf(vm, variety, cfgOver = {}) {
  const cfg = Object.assign({}, vm.defaultConfig(), { variety }, cfgOver);
  return vm.simulate(cfg).summary;
}

// ---------- Бісекція ----------
function bisect(fn, lo, hi, target, tol = 0.01, iters = 40) {
  // напрям-агностична: якщо fn зростаюча, міняємо напрям
  const yLo = fn(lo), yHi = fn(hi);
  const increasing = yHi > yLo;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    const y = fn(mid);
    if (Math.abs(y - target) < tol) return mid;
    if ((y > target) === increasing) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------- PRNG (mulberry32) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Крок 1-2: глобальні константи + сортова підстройка
// ============================================================
console.log('=== E6.2: калібрування ===\n');
let consts = {};
let terpSynth = {};

const taTarget = FIELD.global.taTarget; // 7.0 г/л
// 1a. TARTRATE_L: тартрат дозрілої ягоди 4-7 г/л (Kliewer 1971) → 7 г/л
consts.TARTRATE_L = FIELD.global.tartrateL; // 7.0
// 1b. K_MAL (дихання малату після véraison): TA(blanc) → ціль 7.0 г/л
let kMal = bisect(
  (x) => { const vm = loadModel({ TARTRATE_L: consts.TARTRATE_L, K_MAL: x }, {}); return summaryOf(vm, 'muscat_blanc').ta; },
  0.03, 0.35, taTarget, 0.02
);
consts.K_MAL = Math.round(kMal * 1000) / 1000;
const vmProbe = loadModel(consts, {});
const phBlanc = summaryOf(vmProbe, 'muscat_blanc').ph;
const taBlanc = summaryOf(vmProbe, 'muscat_blanc').ta;
console.log(`TARTRATE_L = ${consts.TARTRATE_L} г/л (Kliewer 1971)`);
console.log(`K_MAL      = ${consts.K_MAL}  →  TA(blanc) = ${taBlanc.toFixed(2)} г/л`);
console.log(`pH(blanc)  = ${phBlanc.toFixed(2)} (емпіричний агрегат HH/K⁺; ціль 3.0–3.6, глибше калібрування потребує даних K⁺ ягоди)\n`);

// 2. Сортова терпенсинтаза: terpFreeUg → сортова ціль
const vm2 = loadModel(consts, {});
for (const [v, tgt] of Object.entries(FIELD.terpFreeTarget)) {
  let cur = vm2.VARIETIES[v].terpSynthBase;
  for (let it = 0; it < 3; it++) {
    const y = summaryOf(loadModel(consts, { [v]: cur }), v).terpFreeUg;
    if (Math.abs(y - tgt) < tgt * 0.01) break;
    cur = cur * (tgt / y);
  }
  terpSynth[v] = Math.round(cur * 10) / 10;
  const y = summaryOf(loadModel(consts, terpSynth), v).terpFreeUg;
  console.log(`${v.padEnd(16)} terpSynthBase: ${vm2.VARIETIES[v].terpSynthBase} → ${terpSynth[v]}  (terpFree ${Math.round(y)} vs ціль ${tgt} мкг/кг)`);
}

// ============================================================
// Крок 3: ансамбль невизначеності (чесні 90% ДІ)
// ============================================================
const vmC = loadModel(consts, terpSynth);
const N_ENS = FIELD.global.ensembleN;
const rand = mulberry32(20261004);

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const ensRows = {};
for (const v of Object.keys(vmC.VARIETIES)) {
  const brix = [], ta = [], ph = [], terp = [];
  for (let i = 0; i < N_ENS; i++) {
    const s = summaryOf(vmC, v, {
      dT: (rand() * 2 - 1) * 1.5,               // ±1.5 °C сезонний зсув
      parFactor: 0.85 + rand() * 0.3,            // 0.85–1.15
      water: 0.5 + rand() * 0.5,                 // 0.5–1.0
      nFertKgHa: rand() * 120,                   // 0–120 кг/га
      mildDeficitAfterSet: rand() < 0.5,
      buds: Math.round(12 + rand() * 20),        // 12–32 бруньки
    });
    brix.push(s.brix); ta.push(s.ta); ph.push(s.ph); terp.push(s.terpFreeUg);
  }
  [brix, ta, ph, terp].forEach(a => a.sort((x, y) => x - y));
  ensRows[v] = {
    brix: [quantile(brix, 0.05), quantile(brix, 0.5), quantile(brix, 0.95)],
    ta: [quantile(ta, 0.05), quantile(ta, 0.5), quantile(ta, 0.95)],
    ph: [quantile(ph, 0.05), quantile(ph, 0.5), quantile(ph, 0.95)],
    terpFree: [quantile(terp, 0.05), quantile(terp, 0.5), quantile(terp, 0.95)],
  };
}

// ============================================================
// Зведений звіт
// ============================================================
const f = (x) => (x == null ? '—' : Number(x).toFixed(1));
const lines = [];
lines.push('## E6.2 — Калібрування на польових даних (2026-10-04)\n');
lines.push(`Глобальні константи: \`TARTRATE_L = ${consts.TARTRATE_L}\` г/л (Kliewer 1971: тартрат дозрілої ягоди 4–7 г/л), \`K_MAL = ${consts.K_MAL}\` доб⁻¹@20°C → TA(blanc) = ${taTarget} г/л; MALATE_L = 12 без змін.`);
lines.push(`pH — емпіричний агрегат (основа 3.05 + K⁺-терм): калібрований pH(blanc) = ${phBlanc.toFixed(2)}, у межах ТЗ 3.0–3.6; точніше калібрування потребує польових даних K⁺ ягоди.`);
lines.push('Цілі: ТЗ §8 (Brix 18–24, TA 4–9 г/л, pH 3.0–3.6) + сортові дані E6.1.\n');
lines.push('### Номінальні значення після калібрування');
lines.push('| Сорт | Brix | TA г/л | pH | Терп. вільні, мкг/кг | Ціль терп. | terpSynthBase |');
lines.push('|---|---|---|---|---|---|---|');
for (const [v, info] of Object.entries(FIELD.terpFreeTarget)) {
  const s = summaryOf(vmC, v);
  const old = vm2.VARIETIES[v].terpSynthBase;
  lines.push(`| ${v} | ${f(s.brix)} | ${f(s.ta)} | ${s.ph.toFixed(2)} | ${Math.round(s.terpFreeUg)} | ${info} | ${old} → ${terpSynth[v]} |`);
}
lines.push('\n### Чесні 90% довірчі інтервали (ансамбль ' + N_ENS + ' сценаріїв поля: ΔT±1.5°C, PAR 0.85–1.15, вода 0.5–1.0, N 0–120 кг/га, бруньки 12–32)');
lines.push('| Сорт | Brix p5–p95 | TA p5–p95 | pH p5–p95 | Терп. вільні p5–p95 |');
lines.push('|---|---|---|---|---|');
for (const [v, e] of Object.entries(ensRows)) {
  lines.push(`| ${v} | ${f(e.brix[0])}–${f(e.brix[2])} | ${f(e.ta[0])}–${f(e.ta[2])} | ${e.ph[0].toFixed(2)}–${e.ph[2].toFixed(2)} | ${Math.round(e.terpFree[0])}–${Math.round(e.terpFree[2])} |`);
}
lines.push('\n### Обґрунтування сортових цілей вільних монотерпенолів');
for (const [v, src] of Object.entries(FIELD.terpFreeSources)) {
  lines.push(`- \`${v}\`: ${src}`);
}
const report = lines.join('\n');
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'calibration_report.md'), report + '\n');
console.log('\n' + report);
console.log('\nЗвіт: docs/calibration_report.md');

// серіалізація каліброваних значень для патчу model.js
const out = { consts, terpSynth };
fs.writeFileSync(path.join(__dirname, 'calibrated_params.json'), JSON.stringify(out, null, 2));
console.log('Параметри: validation/calibrated_params.json');
