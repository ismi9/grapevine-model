/**
 * VineSeason UI — зв'язування інтерфейсу з ядром VineModel.
 * Українська локалізація, миттєвий перерахунок (< 1 c на зміну повзунка).
 */
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const cfg = VineModel.defaultConfig();
  let baseRun = null;          // збережений базовий сценарій для порівняння A/B
  let run = null;              // поточний прогін
  let scrubDay = 150;

  // ---------- Заповнення селектів ----------
  const selV = $('ctl-variety');
  for (const [k, v] of Object.entries(VineModel.VARIETIES)) {
    const o = document.createElement('option'); o.value = k; o.textContent = v.name; selV.appendChild(o);
  }
  const selT = $('ctl-tempScenario');
  for (const [k, v] of Object.entries(VineModel.TEMP_SCENARIOS)) {
    const o = document.createElement('option'); o.value = k; o.textContent = 'Сезон: ' + v.name; selT.appendChild(o);
  }
  const selF = $('ctl-soilFertility');
  for (const [k, v] of Object.entries({ poor: 'Бідний', medium: 'Середній', rich: 'Родючий' })) {
    const o = document.createElement('option'); o.value = k; o.textContent = 'Ґрунт: ' + v; selF.appendChild(o);
  }

  // ---------- Реєстр параметрів для таблиці ----------
  const PARAMS = [
    ['EPS0', '0.85 г C / моль PPFD', 'ефективність фотосинтезу в оптимумі', 'assumption'],
    ['RM_BASE', '0.006 г C·г⁻¹DM·доб⁻¹', 'дихання підтримки при 20 °C, Q10 = 2.0', 'assumption'],
    ['GROWTH_COST', '1.4 г C / 1 г C-продукту', 'вартість росту (Penning de Vries-типу)', 'assumption'],
    ['SLA', '0.02 м²/г DM', 'питома площа листя', 'assumption'],
    ['K_EXT', '0.7', 'екстинкція світла в кроні', 'assumption'],
    ['VMAX_N / KM_N', '0.15 г/добу / 0.05 г', 'Міхаеліс–Ментен поглинання N', 'assumption'],
    ['N_CONC (листя)', '2.4% DM', 'оптимум азоту листя', 'assumption'],
    ['MALATE_L / TARTRATE_L', '12 / 10 г/л', 'піки кислот до véraison', 'orient'],
    ['terpSynthBase', '45 (мускат білий)', 'пік синтезу монотерпенолів, мкг/кг·добу', 'assumption'],
    ['GLY_RATE', '0.045/добу × f(T)', 'глікозилювання (ензиматика, T-залежна)', 'assumption'],
    ['LOSS_BASE', '0.008/добу × f(T)', 'окиснення/випаровування вільних терпенів', 'assumption'],
    ['Brix при зборі', '18–24 °Bx', 'правдоподібний діапазон мускатів', 'orient'],
    ['TA / pH дозрівання', '4–9 г/л / 3.0–3.6', 'кислотність і pH', 'orient'],
    ['Ягода мускату біл.', '1–2 г', 'маса ягоди дрібноягідних форм', 'orient'],
  ];
  const badge = t => t === 'assumption'
    ? '<span class="badge assumption">ASSUMPTION</span>'
    : '<span class="badge orient">ОРІЄНТИР ТЗ §8</span>';
  $('param-table').innerHTML =
    '<table><tr><th>Параметр</th><th>Значення</th><th>Пояснення</th><th>Статус</th></tr>' +
    PARAMS.map(p => `<tr><td><code>${p[0]}</code></td><td>${p[1]}</td><td>${p[2]}</td><td>${badge(p[3])}</td></tr>`).join('') +
    '</table>';

  // ---------- Зчитування конфігурації з панелі ----------
  function readConfig() {
    return {
      variety: $('ctl-variety').value,
      tempScenario: $('ctl-tempScenario').value,
      soilFertility: $('ctl-soilFertility').value,
      dT: +$('ctl-dT').value,
      parFactor: +$('ctl-parFactor').value,
      water: +$('ctl-water').value,
      mildDeficitAfterSet: $('ctl-mildDeficit').checked,
      nFertKgHa: +$('ctl-nFertKgHa').value,
      pSupply: +$('ctl-pSupply').value,
      kSupply: +$('ctl-kSupply').value,
      mgSupply: +$('ctl-mgSupply').value,
      bSupply: +$('ctl-bSupply').value,
      znSupply: +$('ctl-znSupply').value,
      buds: +$('ctl-buds').value,
      leafRemoval: +$('ctl-leafRemoval').value,
      canopyExposure: +$('ctl-canopyExposure').value,
    };
  }

  // ---------- Оновлення підписів повзунків ----------
  function refreshOutputs() {
    $('out-dT').textContent = (+$('ctl-dT').value > 0 ? '+' : '') + $('ctl-dT').value + ' °C';
    $('out-par').textContent = (+$('ctl-parFactor').value).toFixed(2) + '×';
    $('out-n').textContent = $('ctl-nFertKgHa').value;
    $('out-water').textContent = Math.round($('ctl-water').value * 100) + '%';
    $('out-buds').textContent = $('ctl-buds').value;
    $('out-leafRem').textContent = Math.round($('ctl-leafRemoval').value * 100) + '%';
    $('out-exp').textContent = Math.round($('ctl-canopyExposure').value * 100) + '%';
    for (const [id, out] of [['ctl-pSupply', 'out-p'], ['ctl-kSupply', 'out-k'], ['ctl-mgSupply', 'out-mg'], ['ctl-bSupply', 'out-b'], ['ctl-znSupply', 'out-zn']]) {
      $(out).textContent = (+$(id).value).toFixed(2);
    }
  }

  // ---------- Перерахунок ----------
  function recalc() {
    Object.assign(cfg, readConfig());
    refreshOutputs();
    const t0 = performance.now();
    run = VineModel.simulate(cfg);
    const ms = performance.now() - t0;
    $('perf-note').textContent = `перерахунок сезону: ${ms.toFixed(0)} мс`;
    renderStats();
    renderCharts();
    renderPheno();
    $('balance-note').textContent =
      `Баланс C: надійшло ${Math.round(run.balance.cIn)} г · вийшло ${Math.round(run.balance.cOut)} г (дихання+опад)`;
  }

  // ---------- Картки підсумків ----------
  function renderStats() {
    const s = run.summary;
    const cards = [
      ['Збір урожаю', s.harvestDate, 'BBCH ' + s.bbchAtHarvest],
      ['Врожай', s.yieldTPerHa.toFixed(1) + ' т/га', (s.yieldKgPerVine * 1000).toFixed(0) + ' г/куш'],
      ['Brix', s.brix.toFixed(1) + ' °Bx', 'TA ' + s.ta.toFixed(1) + ' г/л · pH ' + s.ph.toFixed(2)],
      ['Вільні монотерпеноли', Math.round(s.terpFreeUg) + ' мкг/кг', 'зв\'язані: ' + Math.round(s.terpBoundUg)],
      ['Індекс мускатності', s.muscatIndex.toFixed(0) + '/100', 'aroma potential: ' + Math.round(s.terpTotalUg) + ' мкг/кг'],
      ['Макс. LAI', s.maxLai.toFixed(1), 'GDD: ' + Math.round(s.gddSeason)],
    ];
    $('stats').innerHTML = cards.map(c =>
      `<div class="stat${c[0].includes('мускат') ? ' hl' : ''}"><div class="lbl">${c[0]}</div><div class="val">${c[1]}</div><div class="sub">${c[2]}</div></div>`).join('');
  }

  // ---------- Графіки ----------
  function seriesOf(r, key) { return r.daily.map(x => x[key]); }
  const C = { leaf: '#2d6a4f', shoot: '#8bbec1', root: '#b98a2e', berry: '#c67850', cluster: '#c8d979', wood: '#6b5b95' };

  function renderCharts() {
    const d = run.daily;
    const mk = (key) => seriesOf(run, key);
    const baseSeries = (key, name, color, dashed) => baseRun
      ? { name, color, values: baseRun.daily.map(x => x[key]).slice(0, run.daily.length), dashed, area: false }
      : null;

    // Органи (стопка як окремі серії)
    const organSeries = [
      { name: 'листя', color: C.leaf, values: mk('leafDM'), area: true },
      { name: 'пагони', color: C.shoot, values: mk('shootDM') },
      { name: 'коріння', color: C.root, values: mk('rootDM') },
      { name: 'ягоди', color: C.berry, values: mk('berryDM') },
    ];
    if (baseRun) organSeries.push({ name: 'база: листя', color: '#9db8a4', values: baseRun.daily.map(x => x.leafDM).slice(0, run.daily.length), dashed: true });
    Charts.line($('chart-organs'), organSeries);

    Charts.line($('chart-lai'), [
      { name: 'LAI', color: C.leaf, values: mk('lai'), area: true },
      ...(baseRun ? [{ name: 'база', color: '#9db8a4', values: baseRun.daily.map(x => x.lai).slice(0, run.daily.length), dashed: true }] : []),
    ]);

    Charts.line($('chart-nitrogen'), [
      { name: 'ґрунтовий N, кг/га', color: '#6b5b95', values: mk('soilN') },
      { name: 'поглинання N×100, г/добу', color: '#c67850', values: d.map(x => x.uptakeN * 100) },
    ]);

    Charts.line($('chart-quality'), [
      { name: 'Brix', color: '#c67850', values: mk('brix') },
      { name: 'TA г/л', color: '#6b5b95', values: mk('ta') },
      { name: 'pH×5', color: '#2d6a4f', values: d.map(x => x.pH * 5) },
    ]);
    Charts.line($('chart-terpenes'), [
      { name: 'вільні', color: '#c67850', values: mk('terpFreeUg'), area: true },
      { name: 'зв\'язані', color: '#2d6a4f', values: mk('terpBoundUg') },
      ...(baseRun ? [{ name: 'база: вільні', color: '#9db8a4', values: baseRun.daily.map(x => x.terpFreeUg).slice(0, run.daily.length), dashed: true }] : []),
    ]);
    Charts.line($('chart-yield'), [
      { name: 'кг/куш', color: C.berry, values: mk('yieldKg'), area: true },
    ]);
    Charts.line($('chart-acids'), [
      { name: 'малат', color: '#b98a2e', values: mk('berryMalateG') },
      { name: 'тартрат', color: '#8bbec1', values: mk('berryTartrateG') },
    ]);

    // Потоки (день зі скроба)
    const i = Math.min(scrubDay, run.daily.length - 1);
    const x = run.daily[i];
    Charts.flows($('chart-cflows'), [
      { from: 'Атмосфера (CO₂)', to: 'Листя', value: x.gpp, color: '#2d6a4f' },
      { from: 'Листя', to: 'Ягоди', value: x.berryDM * 0.02 + x.berrySugarG * 0.001, color: '#c67850' },
      { from: 'Листя', to: 'Пагони', value: x.shootDM * 0.005, color: '#8bbec1' },
      { from: 'Листя', to: 'Коріння', value: x.rootDM * 0.004, color: '#b98a2e' },
      { from: 'Листя', to: 'Деревина (резерви)', value: x.availC * 0.3, color: '#6b5b95' },
      { from: 'Листя', to: 'Дихання', value: x.rm, color: '#c67850' },
    ]);
    Charts.flows($('chart-nflows'), [
      { from: 'Ґрунт (N)', to: 'Листя', value: x.uptakeN, color: '#2d6a4f' },
      { from: 'Листя', to: 'Ягоди', value: x.uptakeN * 0.25, color: '#c67850' },
      { from: 'Листя', to: 'Деревина (резерви)', value: x.uptakeN * 0.15, color: '#6b5b95' },
    ]);
  }

  // ---------- Фенологічна стрічка + скроб ----------
  const PHENO_COLORS = ['#183d32', '#2d6a4f', '#3f7d54', '#57926a', '#c67850', '#c8875f', '#b98a2e', '#8bbec1', '#6b5b95', '#68776d'];
  function renderPheno() {
    const strip = $('pheno-strip');
    strip.innerHTML = VineModel.PHENO.map((p, i) =>
      `<div class="pheno-seg" style="background:${PHENO_COLORS[i]}" title="${p.bbch}: ${p.label} (GDD ${p.gdd})">${p.bbch.split('–')[0]}</div>`).join('');
    const i = Math.min(scrubDay, run.daily.length - 1);
    const x = run.daily[i];
    [...strip.children].forEach((el, idx) => el.classList.toggle('cur', idx === x.phenoIdx));
    $('scrub').max = run.daily.length - 1;
    $('scrub').value = i;
    $('scrub-label').textContent = `день ${i + 1} · ${x.date}`;
    const f = x.factors;
    $('day-detail').innerHTML =
      `BBCH <b>${x.bbch}</b> — ${x.stageLabel} · T ${x.T.toFixed(1)}°C · GDD ${Math.round(x.gdd)} · ` +
      `фотосинтез ${x.gpp.toFixed(1)} г C/добу · дихання ${x.rm.toFixed(1)} · ґрунт N ${x.soilN.toFixed(0)} кг/га · ` +
      `лімітують: ${Object.entries(f).filter(([k, v]) => v < 0.98).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ') || 'ніщо'}`;
  }

  // ---------- Торнадо чутливості ----------
  function renderSensitivity() {
    const keys = [
      ['nFertKgHa', 'добриво N'],
      ['water', 'вода'],
      ['parFactor', 'світло PAR'],
      ['buds', 'навантаження (бруньки)'],
      ['kSupply', 'калій K'],
      ['canopyExposure', 'експозиція грона'],
    ];
    const t1 = VineModel.sensitivity(cfg, keys.map(k => k[0]), r => r.summary.terpFreeUg)
      .map((s, i) => ({ label: keys[i][1], minus: s.minus, plus: s.plus }));
    Charts.tornado($('chart-tornado'), t1);
    const t2 = VineModel.sensitivity(cfg, keys.map(k => k[0]), r => r.summary.brix)
      .map((s, i) => ({ label: keys[i][1], minus: s.minus, plus: s.plus }));
    Charts.tornado($('chart-tornado-brix'), t2);
  }

  // ---------- Таби ----------
  document.querySelectorAll('.top nav a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.top nav a').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      $('tab-' + a.dataset.tab).classList.add('active');
      if (a.dataset.tab === 'sens') renderSensitivity();
      if (a.dataset.tab === 'flows' || a.dataset.tab === 'season') renderCharts();
    });
  });

  // ---------- Слайдер дня ----------
  $('scrub').addEventListener('input', e => {
    scrubDay = +e.target.value;
    renderCharts(); renderPheno();
  });

  // ---------- Кнопки ----------
  $('btn-base').addEventListener('click', () => {
    baseRun = VineModel.simulate(cfg);
    recalc();
  });
  $('btn-csv').addEventListener('click', () => {
    const cols = ['day', 'date', 'T', 'gdd', 'bbch', 'lai', 'gpp', 'rm', 'soilN', 'uptakeN',
      'berryFWTotal', 'brix', 'ta', 'ph', 'terpFreeUg', 'terpBoundUg', 'yieldKg'];
    const rows = [cols.join(',')].concat(run.daily.map(x => cols.map(c =>
      typeof x[c] === 'number' ? x[c].toFixed(3) : x[c]).join(',')));
    download('vineseason_' + cfg.variety + '.csv', rows.join('\n'), 'text/csv');
  });
  $('btn-save').addEventListener('click', () => {
    download('vineseason_scenario.json', JSON.stringify(readConfig(), null, 2), 'application/json');
  });
  $('file-load').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const sc = JSON.parse(rd.result);
        for (const [k, v] of Object.entries(sc)) {
          const el = $('ctl-' + k);
          if (!el) continue;
          if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
        }
        recalc();
      } catch { alert('Не вдалося прочитати сценарій'); }
    };
    rd.readAsText(f);
  });
  function download(name, content, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Слухачі повзунків ----------
  document.querySelectorAll('.controls input, .controls select').forEach(el => {
    el.addEventListener('input', recalc);
    el.addEventListener('change', recalc);
  });
  window.addEventListener('resize', () => { renderCharts(); renderPheno(); });

  // ---------- Старт ----------
  recalc();
})();
