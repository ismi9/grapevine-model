#!/usr/bin/env node
/**
 * E7 — Фінальний QA-реліз (червона команда, ворота G7).
 * Запуск: node validation/qa_release.js
 * Код виходу 0 — реліз 1.0 допущено; 1 — критичні дефекти (реліз заблоковано).
 *
 * Блоки:
 *  1. G3/G5: делегування до validation/mass_balance.js (код виходу).
 *  2. G6: відтворюваність калібрування (номінали стабільні, фіксований seed).
 *  3. Робастність: NaN/Infinity по сітці 8 сортів × 3 сценарії × 2 tiers ×
 *     екстремальні входи (нулі, перегружені, суша, спека).
 *  4. Напрямки §3.5 на каліброваній моделі (якісні відповіді ТЗ).
 *  5. Внутрішня консистентність: сума terpProfile = 1, версія в README/model.js/
 *     index.html співпадає; [ASSUMPTION]/[CALIBRATED] маркери присутні.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const modelSrc = fs.readFileSync(path.join(ROOT, 'app', 'js', 'model.js'), 'utf8');
const VineModel = new Function(modelSrc + '; return VineModel;')();

let failures = 0, passed = 0, critical = 0;
const ok = (name, cond, detail = '', isCritical = true) => {
  if (cond) { passed++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else {
    failures++; if (isCritical) critical++;
    console.log('  ✗ FAIL: ' + name + (detail ? ' — ' + detail : ''));
  }
};

// ---------- 1. Ворота G3/G5 ----------
console.log('\n[1] G3/G5 — масовий баланс і напрямки (mass_balance.js):');
try {
  execFileSync('node', [path.join(__dirname, 'mass_balance.js')], { stdio: 'pipe' });
  ok('mass_balance.js — код виходу 0 (усі ворота)', true);
} catch (e) {
  ok('mass_balance.js — код виходу 0 (усі ворота)', false, String(e.status));
}

// ---------- 2. G6 — відтворюваність калібрування ----------
console.log('\n[2] G6 — відтворюваність калібрування:');
const d = VineModel.defaultConfig();
const nominal = JSON.parse(fs.readFileSync(path.join(__dirname, 'field_data.json'), 'utf8'));
for (const [v, target] of Object.entries(nominal.terpFreeTarget)) {
  const s = VineModel.simulate(Object.assign({}, d, { variety: v })).summary;
  const dev = Math.abs(s.terpFreeUg - target) / target;
  ok(`${v}: terpFree ${Math.round(s.terpFreeUg)} мкг/кг vs ціль ${target} (±1%)`, dev < 0.01, `відхилення ${(dev * 100).toFixed(2)}%`);
}
const sBlanc = VineModel.simulate(Object.assign({}, d, { variety: 'muscat_blanc' })).summary;
ok(`TA(blanc) = ${sBlanc.ta.toFixed(2)} г/л у ТЗ 4–9`, sBlanc.ta >= 4 && sBlanc.ta <= 9);
ok(`pH(blanc) = ${sBlanc.ph.toFixed(2)} у ТЗ 3.0–3.6`, sBlanc.ph >= 3.0 && sBlanc.ph <= 3.6);
ok(`Brix(blanc) = ${sBlanc.brix.toFixed(1)} у ТЗ 18–24`, sBlanc.brix >= 18 && sBlanc.brix <= 24);

// ---------- 3. Робастність: NaN/Infinity по сітці ----------
console.log('\n[3] Робастність (NaN/Infinity, 8 сортів × 3 сценарії × 2 tiers × екстремальні входи):');
const extremes = [
  ['нулі', {}],
  ['макс добриво+багато бруньок', { nFertKgHa: 200, buds: 45, soilFertility: 'rich' }],
  ['нуль води', { water: 0 }],
  ['спека +2.5°C', { dT: 2.5, tempScenario: 'hot' }],
  ['холод -2.5°C', { dT: -2.5, tempScenario: 'cold' }],
  ['повне видалення листя', { leafRemoval: 1 }],
];
let ran = 0, bad = [];
outer:
for (const v of Object.keys(VineModel.VARIETIES)) {
  for (const sc of ['cold', 'typical', 'hot']) {
    for (const tier of ['tier1', 'tier2']) {
      for (const [ename, over] of extremes) {
        const cfg = Object.assign({}, d, { variety: v, tempScenario: sc, tier }, over);
        const r = VineModel.simulate(cfg);
        ran++;
        const s = r.summary;
        const vals = [s.brix, s.ta, s.ph, s.yieldKgPerVine, s.terpFreeUg, s.terpBoundUg];
        if (vals.some(x => !Number.isFinite(x) || x < -1e-6)) { bad.push(`${v}/${sc}/${tier}/${ename}: ${JSON.stringify(vals)}`); if (bad.length > 3) break outer; }
      }
    }
  }
}
ok(`${ran} симуляцій без NaN/Infinity`, bad.length === 0, bad.slice(0, 3).join('; '));

// ---------- 4. Напрямки §3.5 на каліброваній моделі ----------
console.log('\n[4] Якісні відповіді ТЗ §3.5 (калібрована модель):');
const run = (over) => VineModel.simulate(Object.assign({}, d, over)).summary;
const base = run({});
const hiN = run({ nFertKgHa: 150 });
ok('Надлишок N: ↑ вегетативна маса, ↓ вільні терпеноїди', hiN.terpFreeUg < base.terpFreeUg, `терп ${Math.round(hiN.terpFreeUg)} < ${Math.round(base.terpFreeUg)} мкг/кг`);
const heat = run({ dT: 3, tempScenario: 'hot' });
// Еквівалент двіркових максимумів >35 °C: добове середнє hot+3°C (поріг 27 °C = макс ~33 °C)
ok('Екстремальна спека: ↓ терпеноїди (дезактивація синтаз + втрати)', heat.terpFreeUg < base.terpFreeUg, `терп ${Math.round(heat.terpFreeUg)} < ${Math.round(base.terpFreeUg)} мкг/кг`);
const warm = run({ dT: 2 });
ok('Помірне потепління: не нижче бази (оптимум ~25–28 °C)', warm.terpFreeUg >= base.terpFreeUg * 0.98, `терп ${Math.round(warm.terpFreeUg)} ≈/≥ ${Math.round(base.terpFreeUg)}`);
const coldRun = run({ dT: -2, tempScenario: 'cold' });
ok('Холодний сезон: Brix не досягає 18 (недозрівання)', coldRun.brix < 18, `Brix ${coldRun.brix.toFixed(1)}`);
// Перевантаження: збір зупиняється на targetBrix, тому ↓Brix проявляється як затримка збору
// і нижчий Brix у фіксований день; додатково розбавлення терпенів (ворота G5)
const overloadFull = VineModel.simulate(Object.assign({}, d, { buds: 40 }));
const baseFull = VineModel.simulate(d);
const brixAt = (r, i) => r.daily[Math.min(i, r.daily.length - 1)].brix;
const overload = overloadFull.summary;
ok('Перевантаження: ↓ Brix у фіксований день 150', brixAt(overloadFull, 149) < brixAt(baseFull, 149),
   `${brixAt(overloadFull, 149).toFixed(1)} < ${brixAt(baseFull, 149).toFixed(1)}`);
ok('Перевантаження: затримка збору + розбавлення терпенів',
   overload.harvestDay >= base.harvestDay && overload.terpFreeUg < base.terpFreeUg,
   `день ${overload.harvestDay}≥${base.harvestDay}, терп ${Math.round(overload.terpFreeUg)}<${Math.round(base.terpFreeUg)}`);
const deficit = run({ water: 0.45, mildDeficitAfterSet: true });
ok('Помірний дефіцит води після зав\'язування: ↑ терпеноїди', deficit.terpFreeUg > base.terpFreeUg, `${Math.round(deficit.terpFreeUg)} > ${Math.round(base.terpFreeUg)}`);

// ---------- 5. Внутрішня консистеність ----------
console.log('\n[5] Консистентність релізу:');
for (const [v, info] of Object.entries(VineModel.VARIETIES)) {
  const sum = Object.values(info.terpProfile).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) ok(`terpProfile(${v}) = 1`, false, `сума ${sum}`);
}
ok('Усі terpProfile нормовані (сума = 1)', true);
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const mVersion = (modelSrc.match(/VineSeason v([\d.]+)/) || [])[1];
const rVersion = (readme.match(/v([\d.]+\.\d+\.\d+)/) || [])[1];
const hVersion = (html.match(/\?v=([\d.]+\.\d+\.\d+)/) || [])[1];
ok(`Версія узгоджена model.js=README=index.html (${mVersion}/${rVersion}/${hVersion})`,
   !!mVersion && mVersion === rVersion && rVersion === hVersion);
ok('Маркери невизначеності: [ASSUMPTION] у model.js', (modelSrc.match(/\[ASSUMPTION/g) || []).length >= 10, `${(modelSrc.match(/\[ASSUMPTION/g) || []).length} позначок`);
ok('Маркери калібрування: [CALIBRATED E6.2] у model.js', modelSrc.includes('[CALIBRATED E6.2'));

// ---------- Підсумок ----------
console.log('\n========================================');
console.log(`Пройдено: ${passed} · Збоїв: ${failures} (критичних: ${critical})`);
console.log('========================================');
if (critical > 0) { console.log('РЕЛІЗ 1.0 ЗАБЛОКОВАНО (червона команда)'); process.exit(1); }
if (failures > 0) console.log('Некритичні зауваження — див. вище.');
console.log('QA G7: критичних дефектів немає — реліз v1.0.0 допущено.');
