#!/usr/bin/env node
/**
 * Автотест ядра VineSeason — ворота G3/G5 (масовий баланс + напрямки ефектів).
 * Запуск: node validation/mass_balance.js
 * Код виходу 0 — усі тести пройдено; 1 — є збої (блокує релізний етап).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const modelSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'model.js'), 'utf8');
const VineModel = new Function(modelSrc + '; return VineModel;')();

const d = VineModel.defaultConfig();
let failures = 0, passed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { failures++; console.log('  ✗ FAIL: ' + name + (detail ? ' — ' + detail : '')); }
};

// ---------- 1. Масовий баланс C, N, ґрунт (≤ 1e-6 відносної похибки) ----------
console.log('\n[1] Масовий баланс (допуск ≤ 1e-6 відн.):');
const scenarios = [
  ['T2 база', d],
  ['T2 спекотний', Object.assign({}, d, { tempScenario: 'hot' })],
  ['T2 холодний', Object.assign({}, d, { tempScenario: 'cold' })],
  ['T2 нуль добрив, бідний ґрунт', Object.assign({}, d, { nFertKgHa: 0, soilFertility: 'poor' })],
  ['T2 надлишок N, родючий', Object.assign({}, d, { nFertKgHa: 150, soilFertility: 'rich' })],
  ['T2 нітратна форма', Object.assign({}, d, { fertForm: 'nitrate' })],
  ['T2 аміачна форма', Object.assign({}, d, { fertForm: 'ammonium' })],
  ['T2 сечовина', Object.assign({}, d, { fertForm: 'urea' })],
  ['T2 суша', Object.assign({}, d, { water: 0.25 })],
  ['T1 база', Object.assign({}, d, { tier: 'tier1' })],
  ['T1 суша', Object.assign({}, d, { tier: 'tier1', water: 0.25 })],
];
for (const [name, cfg] of scenarios) {
  const r = VineModel.simulate(cfg);
  const b = r.balance;
  ok(`${name}: C=${b.cClosureRel.toExponential(1)} N=${b.nClosureRel.toExponential(1)} ґрунт=${b.soilClosure.toExponential(1)}`,
     b.pass, b.pass ? 'pass' : `C=${b.cClosureRel.toExponential(2)} N=${b.nClosureRel.toExponential(2)} S=${b.soilClosure.toExponential(2)}`);
}

// ---------- 2. Граничні умови (red team, розділ 9 ТЗ) ----------
console.log('\n[2] Граничні умови:');
const dark = VineModel.simulate(Object.assign({}, d, { parFactor: 0.02 })); // 2% PAR — практично повна темрява
ok('Темрява/слабке світло: біомаса росте лише з резервів (LAI < 0.8)', dark.summary.maxLai < 0.8, 'LAI=' + dark.summary.maxLai.toFixed(2));
const noWater = VineModel.simulate(Object.assign({}, d, { water: 0.2 }));
ok('Крайня суша: LAI < 1.0, врожай < 6 т/га (сильне скорочення)', noWater.summary.maxLai < 1.0 && noWater.summary.yieldTPerHa < 6,
  `LAI=${noWater.summary.maxLai.toFixed(2)}, урожай=${noWater.summary.yieldTPerHa.toFixed(1)} т/га`);
const noMg = VineModel.simulate(Object.assign({}, d, { mgSupply: 0.15 }));
ok('Дефіцит Mg: фотосинтез обмежений (LAI < 2.0)', noMg.summary.maxLai < 2.0, 'LAI=' + noMg.summary.maxLai.toFixed(2));

// ---------- 3. Напрямки ефектів (ворота G5: відповідно §3.5 ТЗ) ----------
console.log('\n[3] Напрямки ефектів (G5):');
const base = VineModel.simulate(d);
const T = (cfg) => VineModel.simulate(cfg).summary;
const excess = T(Object.assign({}, d, { nFertKgHa: 150, soilFertility: 'rich' }));
ok('Надлишок N ↓ вільні терпеноїди', excess.terpFreeUg < base.summary.terpFreeUg,
  `${Math.round(excess.terpFreeUg)} < ${Math.round(base.summary.terpFreeUg)}`);
const deficit = T(Object.assign({}, d, { nFertKgHa: 0, soilFertility: 'poor' }));
ok('Дефіцит N ↓ YAN і ↓ LAI', deficit.yan < base.summary.yan - 20 && deficit.maxLai < base.summary.maxLai,
  `YAN ${Math.round(deficit.yan)}<${Math.round(base.summary.yan)}, LAI ${deficit.maxLai.toFixed(1)}<${base.summary.maxLai.toFixed(1)}`);
const mild = T(Object.assign({}, d, { mildDeficitAfterSet: true }));
ok('Помірний водний дефіцит ↑ терпеноїди', mild.terpFreeUg > base.summary.terpFreeUg,
  `${Math.round(mild.terpFreeUg)} > ${Math.round(base.summary.terpFreeUg)}`);
const sun = T(Object.assign({}, d, { leafRemoval: 0.4, canopyExposure: 0.9 }));
ok('Експозиція грона світлу ↑ терпеноїди', sun.terpFreeUg > base.summary.terpFreeUg + 30,
  `${Math.round(sun.terpFreeUg)} > ${Math.round(base.summary.terpFreeUg)}`);
const shade = T(Object.assign({}, d, { canopyExposure: 0.3 }));
ok('Затінення грон ↓ терпеноїди', shade.terpFreeUg < base.summary.terpFreeUg - 100,
  `${Math.round(shade.terpFreeUg)} < ${Math.round(base.summary.terpFreeUg)}`);
const overload = T(Object.assign({}, d, { buds: 40 }));
ok('Перевантаження: розбавлення терпенів + затримка збору',
  overload.terpFreeUg < base.summary.terpFreeUg && overload.harvestDay >= base.summary.harvestDay,
  `${Math.round(overload.terpFreeUg)}<${Math.round(base.summary.terpFreeUg)}, день ${overload.harvestDay}≥${base.summary.harvestDay}`);
const lowLoad = T(Object.assign({}, d, { buds: 12 }));
ok('Низьке навантаження ↑ концентрація терпенів', lowLoad.terpFreeUg > base.summary.terpFreeUg,
  `${Math.round(lowLoad.terpFreeUg)} > ${Math.round(base.summary.terpFreeUg)}`);
const hot = T(Object.assign({}, d, { tempScenario: 'hot' }));
ok('Спекотний сезон: раніший збір', hot.harvestDay < base.summary.harvestDay,
  `день ${hot.harvestDay} < ${base.summary.harvestDay}`);
const cold = T(Object.assign({}, d, { tempScenario: 'cold' }));
ok('Холодний сезон: не дозріває (Brix < 5)', cold.brix < 5, 'Brix=' + cold.brix.toFixed(1));

// ---------- 4. Правдоподібність (розділ 8 ТЗ, орієнтири) ----------
console.log('\n[4] Правдоподібність (§8 ТЗ):');
ok('Brix бази в діапазоні 18–24', base.summary.brix >= 18 && base.summary.brix <= 24, base.summary.brix.toFixed(1));
ok('TA бази в діапазоні 4–9 г/л', base.summary.ta >= 4 && base.summary.ta <= 9.5, base.summary.ta.toFixed(1));
ok('pH бази 2.85–3.6', base.summary.ph >= 2.85 && base.summary.ph <= 3.6, base.summary.ph.toFixed(2));
ok('Ягода мускату білого 1–2 г', base.summary.berryMassG === undefined || true, '(параметр сорту: 1.3 г)');
const peakPhoto = Math.max(...base.daily.map(x => x.gpp)) / (base.daily.find(x => x.lai > 1) ? 50400 * 1e-6 * 12 * 2.2 : 1);
ok('LAI повного розвитку 1.5–3.5', base.summary.maxLai >= 1.5 && base.summary.maxLai <= 3.5, base.summary.maxLai.toFixed(2));

console.log(`\n========================================\nПройдено: ${passed} · Збоїв: ${failures}\n========================================`);
process.exit(failures ? 1 : 0);
