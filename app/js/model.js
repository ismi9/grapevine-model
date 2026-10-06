/**
 * VineSeason v1.0.0 (реліз E7) — Grapevine Season Model — Tier 1 + Tier 2
 * Vitis vinifera L., мускатні сорти: C/N-баланс, фенологія BBCH (GDD),
 * ягода (Brix/TA/pH), монотерпеноли.
 *
 * TIER 1 (балансова модель): добова ефективність фотосинтезу ε₀,
 *   один мінеральний N-пул, сумарні терпени (вільні/зв'язані).
 * TIER 2 (E5): FvCB-фотосинтез (Vcmax/Jmax, піковий Арреніус, 5 шарів крони,
 *   Vcmax ← N листя), форми N у ґрунті (NO₃⁻/NH₄⁺/сечовина: гідроліз,
 *   нітрифікація, вимивання, денітрифікація), внутрішні пули N (нітратний запас,
 *   амінний пул, вартість відновлення NO₃⁻ у C), мережа монотерпенолів
 *   MEP-шляху по окремих сполуках (ліналоол, гераніол, нерол, α-терпінеол,
 *   цитронелол, оксиди ліналоолу) з окремими швидкостями глікозилювання.
 *
 * Одиниці: г DM / г C / г N на куш; °C; моль·м⁻²·доба⁻¹; мкг терпеноїдів на куш.
 * Джерела/ASSUMPTION: model_spec/parameters.yaml. Масовий баланс: exact-леджер,
 *   перевірка у validation/mass_balance.js (автотест ≤ 1e-6 відн. похибки).
 */
'use strict';

const VineModel = (function () {
  // ================= Загальні константи =================
  const N_DAYS = 214;
  const VINE_AREA_M2 = 2.2;
  const DENSITY_VINES_HA = 10000 / VINE_AREA_M2;
  const KG_HA_TO_G_VINE = 1000 / DENSITY_VINES_HA;
  const C_FRAC_DM = 0.45;
  const GROWTH_COST = 1.4;       // г C асиміляту на 1 г C структури [Penning de Vries-типу, ASSUMPTION]
  const SUGAR_COST = 1.05;       // транспорт сахарози у ягоду (завантаження флоеми) [ASSUMPTION]
  const Q10_MAINT = 2.0;
  const Q10_MALATE = 2.1;
  const SLA = 0.02;
  const K_EXT = 0.7;
  const RM_BASE = 0.006;         // г C·г⁻¹DM·доба⁻¹ при 20 °C [ASSUMPTION]
  const KM_N = 0.05;             // г N/куш, Міхаеліс поглинання NO₃⁻ [ASSUMPTION]
  const KM_NH4 = 0.02;           // г N/куш, NH₄⁺ — вища спорідненість [ASSUMPTION]
  const VMAX_NO3 = 0.12;         // г N/добу при 20 °C [ASSUMPTION]
  const VMAX_NH4 = 0.08;         // г N/добу при 20 °C [ASSUMPTION]
  const NITRATE_REDUCT_COST = 0.60;  // г C / г N відновлення NO₃⁻→NH₄⁺+асиміляція [ASSUMPTION: ~3.4−1.9 г глюкози/г N]
  const NH4_ASSIM_COST = 0.05;       // г C / г N (GS/GOGAT) [ASSUMPTION]
  const NITRATE_STORE_CAP = 1.2;     // г N запасу нітрату [ASSUMPTION]
  const K_NITRATE_REDUCT = 0.18;     // доба⁻¹ при 20 °C [ASSUMPTION]
  const N_CONC = { leaf: 0.024, shoot: 0.010, root: 0.013, wood: 0.004, berry: 0.006 };
  const MALATE_L = 12, TARTRATE_L = 7.0, K_MAL = 0.08; // TARTRATE_L за Kliewer 1971 (4-7 г/л), K_MAL → TA(blanc)=7 г/л [CALIBRATED E6.2: validation/calibrate.js]
  const GLY_RATE = 0.045;        // базова частка глікозилювання (Tier 1) [ASSUMPTION]
  const LOSS_BASE = 0.008;

  // ================= Сорти =================
  const VARIETIES = {
    muscat_blanc: {
      name: 'Мускат білий (дрібноягідний)',
      berryFW_g: 1.3, dxsActivity: 1.00, terpSynthBase: 95.2, phenoShift: 0.00,
      targetBrix: 20.5, laiMax: 3.0, berryPerCluster: 110, clustersPerShoot: 1.7,
      // Профіль монотерпенсинтаз (частки MEP→сполука) [ASSUMPTION: калібрувальний, верифікувати E1]
      terpProfile: { linalool: 0.50, geraniol: 0.20, nerol: 0.12, terpineol: 0.10, citronellol: 0.08 },
    },
    muscat_alexandria: {
      name: 'Мускат Александрійський',
      berryFW_g: 2.4, dxsActivity: 0.72, terpSynthBase: 50.7, phenoShift: 0.06,
      targetBrix: 19.5, laiMax: 2.7, berryPerCluster: 95, clustersPerShoot: 1.5,
      terpProfile: { linalool: 0.30, geraniol: 0.35, nerol: 0.15, terpineol: 0.12, citronellol: 0.08 },
    },
    muscat_ottonel: {
      name: 'Мускат Оттонель',
      berryFW_g: 1.9, dxsActivity: 0.55, terpSynthBase: 38.3, phenoShift: -0.03,
      targetBrix: 20.0, laiMax: 2.8, berryPerCluster: 100, clustersPerShoot: 1.4,
      terpProfile: { linalool: 0.45, geraniol: 0.18, nerol: 0.14, terpineol: 0.15, citronellol: 0.08 },
    },
    muscat_hamburg: {
      name: 'Мускат гамбурзький (червоний)',
      berryFW_g: 2.2, dxsActivity: 0.62, terpSynthBase: 32.6, phenoShift: 0.04,
      targetBrix: 19.0, laiMax: 2.9, berryPerCluster: 105, clustersPerShoot: 1.5,
      terpProfile: { linalool: 0.35, geraniol: 0.25, nerol: 0.13, terpineol: 0.17, citronellol: 0.10 },
    },
    muscat_rose: {
      name: 'Мускат рожевий (à petits grains rouges)',
      // Мутація Муската білого: ягода 11-18×10-17 мм, грона 108-204 г; Одеса: цукор 17.9-24.2 г/100мл,
      // кислотність 4.8-9.1 г/л, дозрівання III дек. вересня (140 днів, САТ 2900°С) [ДОЖЕРЕЛО: Держреєстр РФ/Одеса]
      berryFW_g: 1.7, dxsActivity: 0.95, terpSynthBase: 78.1, phenoShift: 0.10,
      targetBrix: 21.5, laiMax: 3.0, berryPerCluster: 115, clustersPerShoot: 1.6,
      // Рожеві ноти (казанликська троянда): підвищені гераніол/цитронелол [ASSUMPTION: профіль за описом аромату]
      terpProfile: { linalool: 0.38, geraniol: 0.28, nerol: 0.14, terpineol: 0.10, citronellol: 0.10 },
    },
    muscat_yellow: {
      name: 'Мускат жовтий (Moscato Giallo)',
      // Високий вміст вільних+глікозильованих монотерпеноїдів (GC-MS, FEM 2023); ягода дрібна, грони циліндричні
      berryFW_g: 1.8, dxsActivity: 0.85, terpSynthBase: 66.4, phenoShift: 0.03,
      targetBrix: 20.5, laiMax: 2.6, berryPerCluster: 90, clustersPerShoot: 1.3,
      terpProfile: { linalool: 0.45, geraniol: 0.22, nerol: 0.13, terpineol: 0.12, citronellol: 0.08 },
    },
    muscat_odesa: {
      name: 'Мускат одеський (укр. селекція)',
      // Мускат синій ранній × Пьеррелль; ягода 1.8-2.0 г янтарна, грона 130-190 г, 1.2 грона/пагін;
      // цукор 18.6-22.0%, кислотність 5.5-8.7 г/л, ранньосередній (130-140 днів) [ДОЖЕРЕЛО: vinograd7.ru, ІВіВ ім. Вєрова]
      berryFW_g: 1.9, dxsActivity: 0.65, terpSynthBase: 44.2, phenoShift: -0.02,
      targetBrix: 20.0, laiMax: 2.7, berryPerCluster: 95, clustersPerShoot: 1.2,
      terpProfile: { linalool: 0.42, geraniol: 0.22, nerol: 0.14, terpineol: 0.14, citronellol: 0.08 },
    },
    muscat_amber: {
      name: 'Мускат янтарний (укр. селекція)',
      // Дуже ранній столовий; ягода 1.8-2.3 г, грона 280 г, цукор до 20-23%, легкий мускатний аромат
      // [ДОЖЕРЕЛО: Держреєстр, дис. Криворучко] — столовий: нижча терпенсинтаза
      berryFW_g: 2.1, dxsActivity: 0.45, terpSynthBase: 24.5, phenoShift: -0.08,
      targetBrix: 20.0, laiMax: 2.5, berryPerCluster: 100, clustersPerShoot: 1.4,
      terpProfile: { linalool: 0.40, geraniol: 0.20, nerol: 0.15, terpineol: 0.15, citronellol: 0.10 },
    },

  };

  // Глікозилювання окремих сполук, доба⁻¹ × fEnz(T) [ASSUMPTION: VvGT14 — гераніол; верифікувати]
  const GLY_COMPOUND = { linalool: 0.035, geraniol: 0.055, nerol: 0.040, terpineol: 0.030, citronellol: 0.045, oxides: 0.020 };
  // Пороги одоряції у вині, мкг/л [ASSUMPTION: порядок за літературою про монотерпеноли]
  const ODOR_THRESHOLD = { linalool: 25, geraniol: 30, nerol: 45, terpineol: 300, citronellol: 100, oxides: 200 };

  // ================= Погода =================
  const TEMP_SCENARIOS = {
    cold:    { name: 'Холодний',  monthlyT: [8.5, 13.5, 16.5, 17.5, 14.5, 11.0, 7.5] },
    typical: { name: 'Типовий',   monthlyT: [10.5, 15.5, 19.5, 21.5, 17.5, 13.5, 9.0] },
    hot:     { name: 'Спекотний', monthlyT: [12.5, 17.5, 22.5, 25.0, 20.5, 15.5, 11.0] },
  };
  const MONTH_PPFD = [26, 33, 40, 41, 35, 26, 18];
  const SOIL_FERTILITY = {
    poor:   { name: 'Бідний',   initialN: 12, mineralization: 0.15 },
    medium: { name: 'Середній', initialN: 30, mineralization: 0.35 },
    rich:   { name: 'Родючий',  initialN: 55, mineralization: 0.65 },
  };

  // ================= Фенологія BBCH =================
  const PHENO = [
    { bbch: '01–09', label: 'Плач лози · бруньки', gdd: 0 },
    { bbch: '11–19', label: 'Ріст листя й пагонів', gdd: 80 },
    { bbch: '53–57', label: 'Розвиток суціть', gdd: 200 },
    { bbch: '61–69', label: 'Цвітіння', gdd: 320 },
    { bbch: '71', label: "Зав'язування", gdd: 430 },
    { bbch: '73–77', label: 'Ріст ягід — фаза I', gdd: 520 },
    { bbch: '79', label: 'Закриття грона · лаг-фаза', gdd: 780 },
    { bbch: '81–85', label: 'Véraison', gdd: 900 },
    { bbch: '87–89', label: 'Дозрівання', gdd: 1080 },
    { bbch: '91–97', label: 'Ремобілізація · листопад', gdd: 1300 },
  ];
  const ALLOC = {
    veg:     { leaf: 0.45, shoot: 0.25, root: 0.15, reserve: 0.05, berry: 0.00, cluster: 0.10 },
    bloom:   { leaf: 0.30, shoot: 0.20, root: 0.10, reserve: 0.05, berry: 0.00, cluster: 0.35 },
    fruit:   { leaf: 0.18, shoot: 0.10, root: 0.12, reserve: 0.10, berry: 0.50, cluster: 0.00 },
    veraison:{ leaf: 0.05, shoot: 0.05, root: 0.10, reserve: 0.20, berry: 0.60, cluster: 0.00 },
    ripen:   { leaf: 0.00, shoot: 0.00, root: 0.10, reserve: 0.30, berry: 0.60, cluster: 0.00 },
    autumn:  { leaf: 0.00, shoot: 0.00, root: 0.20, reserve: 0.80, berry: 0.00, cluster: 0.00 },
  };

  function defaultConfig() {
    return {
      tier: 'tier2',
      variety: 'muscat_blanc',
      soilFertility: 'medium',
      tempScenario: 'typical',
      fertForm: 'mixed',          // nitrate | ammonium | urea | mixed
      dT: 0, parFactor: 1.0, water: 0.75,
      mildDeficitAfterSet: false,
      nFertKgHa: 60,
      fertSplit: { preBloom: 0.30, fruitSet: 0.40, postVeraison: 0.30 },
      pSupply: 1.0, kSupply: 1.0, mgSupply: 1.0, bSupply: 1.0, znSupply: 1.0,
      buds: 22, leafRemoval: 0.0, canopyExposure: 0.75,
    };
  }

  // ================= Утиліти =================
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const R_GAS = 0.008314; // kJ·mol⁻¹·K⁻¹

  function dayTemp(cfg, d) {
    const m = TEMP_SCENARIOS[cfg.tempScenario].monthlyT;
    const t = d / 30.4;
    const i = clamp(Math.floor(t), 0, m.length - 2);
    return lerp(m[i], m[i + 1], t - i) + cfg.dT;
  }
  function dayPPFD(cfg, d) {
    const t = d / 30.4;
    const i = clamp(Math.floor(t), 0, MONTH_PPFD.length - 2);
    return lerp(MONTH_PPFD[i], MONTH_PPFD[i + 1], t - i) * cfg.parFactor;
  }
  function fTempPhoto(T) {              // Tier 1: дзвін, Topt 26 °C
    const Topt = 26, Tlow = 8, Thigh = 38;
    if (T <= Tlow || T >= Thigh) return 0.05;
    if (T <= Topt) return 0.35 + 0.65 * (T - Tlow) / (Topt - Tlow);
    return 0.35 + 0.65 * (Thigh - T) / (Thigh - Topt);
  }
  function fTempTerpene(T) {
    // T тут — ДОБОВЕ СЕРЕДНЄ. Фізіологічні пороги дезактивації синтаз і втрат
    // (двтіркові максимуми >32-35 °C) конвертовано в еквіваленти середнього:
    // макс 32-33 °C ≈ середнє 27 °C (розмах доби ~6 °C у серпні).
    // [FIXED E7 QA: попередні пороги за добовим максимумом ніколи не спрацьовували]
    if (T < 12) return 0.10;
    if (T <= 27) return 0.20 + 0.80 * (T - 12) / 15;
    return clamp(0.55 - (T - 27) * 0.12, 0, 0.55);
  }
  // Температурна відповідь ферментативних кінетик Tier 2 [ASSUMPTION: форма за FvCB-типовими
  // кривими (Енергія активації + високотемпературна дезактивація); параметри калібрувальні, E1 верифікувати]
  // fV: базова активація Ha = 50 кДж/моль (Q10 ≈ 2.1 при 25 °C) × плавна дезактивація при T > 34 °C
  function fVcmax(T) {
    const act = Math.exp(50 * (T - 25) / (0.008314 * (T + 273.15) * 298.15));
    return act / (1 + Math.exp((T - 34) / 2));
  }
  function phenologyIndex(gdd, shift) {
    let idx = 0;
    for (let i = 0; i < PHENO.length; i++) if (gdd >= PHENO[i].gdd * (1 + shift)) idx = i;
    return idx;
  }
  function allocPhase(idx) {
    if (idx <= 2) return ALLOC.veg;
    if (idx === 3) return ALLOC.bloom;
    if (idx <= 6) return ALLOC.fruit;
    if (idx === 7) return ALLOC.veraison;
    if (idx === 8) return ALLOC.ripen;
    return ALLOC.autumn;
  }
  function dayToDate(d) {
    const date = new Date(2026, 3, 1 + d);
    return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  }

  // ================= FvCB (Tier 2) =================
  // Фаркуар–фон Кеммерер–Беррі, добовий агрегат: 5 шарів крони по градієнту PAR.
  const CA = 420;        // ppm CO₂ [ASSUMPTION: сучасна атмосфера ~420]
  const O2 = 210000;    // ppm
  const DAYLEN_S = 50400; // 14 год світла [ASSUMPTION: помірна широта, середнє за сезон]
  function fvcbCanopy(T, ppfdDay, leafArea, vcmax25, jmax25, fWater) {
    // Кінетика за 25 °C [Bernacchi et al. 2001/2003 — верифікувати]:
    const Kc = 404, Ko = 278000, Gamma25 = 42.9;
    // температурне масштабування (експоненти Берначчі, спрощено) [верифікувати]
    const KcT = Kc * Math.exp(0.0742 * (T - 25));
    const KoT = Ko * Math.exp(0.0439 * (T - 25));
    const GamT = Gamma25 * Math.exp(0.0307 * (T - 25));
    const Vcmax = vcmax25 * fVcmax(T);
    const Jmax = jmax25 * fVcmax(T) * (1 - 0.02 * clamp(T - 25, 0, 10)); // Jmax дезактивується трохи раніше
    const ci = CA * 0.70 * clamp(fWater, 0.3, 1.0);   // продихи: стрес знижує ci [спрощено]
    // середньодобовий PAR на горизонті листя, мкмоль·м⁻²·с⁻¹
    const I0 = ppfdDay / DAYLEN_S * 1e6;
    const alphaE = 0.3;                               // ефективність електронного транспорту [ASSUMPTION]
    const layers = 5;
    const laiLayer = (leafArea / VINE_AREA_M2) / layers;
    let aSum = 0; // мкмоль CO₂·м⁻²(листя)·с⁻¹, усереднено
    for (let L = 0; L < layers; L++) {
      const Ii = I0 * Math.exp(-K_EXT * laiLayer * (L + 0.5));
      const Ji = Jmax * (alphaE * Ii) / Math.sqrt(Jmax * Jmax + (alphaE * Ii) * (alphaE * Ii));
      const Ac = Vcmax * Math.max(0, ci - GamT) / (ci + KcT * (1 + O2 / KoT));
      const Aj = Ji * Math.max(0, ci - GamT) / (4 * (ci + 2 * GamT));
      aSum += Math.min(Ac, Aj) * laiLayer;
    }
    // г C / добу на куш: мкмоль CO₂·м⁻²·с⁻¹ × с × моль/мкмоль × г C/моль × 12
    return aSum * leafArea / Math.max(1e-9, (leafArea / VINE_AREA_M2)) * 0 + aSum * DAYLEN_S * 1e-6 * 12 * VINE_AREA_M2;
  }

  // ================= Головна симуляція =================
  function simulate(userCfg) {
    const cfg = Object.assign(defaultConfig(), userCfg || {});
    const V = VARIETIES[cfg.variety];
    const tier2 = cfg.tier === 'tier2';
    const res = { daily: [], summary: {}, balance: {}, cfg };
    const FERT = SOIL_FERTILITY[cfg.soilFertility] || SOIL_FERTILITY.medium;

    // --- Стани: C ---
    let cLeaf = 0, cShoot = 20 * C_FRAC_DM, cRoot = 350 * C_FRAC_DM, cCluster = 0;
    let cBerryStruct = 0, cBerrySugar = 0, cWoodStarch = 90, cRootReserve = 25;
    // --- Стани: N (рослина) ---
    let leafN = 0, otherN = (20 * N_CONC.shoot) + (350 * N_CONC.root); // пагони+коріння старт
    let reserveN = 2.6;
    let nitrateStore = 0, aminoPool = 0.3;   // Tier 2: внутрішні пули
    // --- Ґрунт ---
    let soilN = FERT.initialN;               // Tier 1: один пул
    let soilNo3 = tier2 ? FERT.initialN * 0.75 : 0;
    let soilNh4 = tier2 ? FERT.initialN * 0.25 : 0;
    let soilUrea = 0;
    // --- Інше ---
    let gdd = 0, berriesCount = 0, harvestDay = null, fruitSetDone = false;
    let berryFWTotal = 0, berryMalateG = 0, berryTartrateG = 0, berryN = 0;
    let cumNSpend = 0, cumNDemand = 0;
    let terpFreeT1 = 0, terpBoundT1 = 0;                       // Tier 1: сумарні
    const terpF = { linalool: 0, geraniol: 0, nerol: 0, terpineol: 0, citronellol: 0, oxides: 0 };
    const terpB = { linalool: 0, geraniol: 0, nerol: 0, terpineol: 0, citronellol: 0, oxides: 0 };
    const nClusters = cfg.buds * V.clustersPerShoot;

    const fertEvents = [
      { atGdd: 250, frac: cfg.fertSplit.preBloom },
      { atGdd: 500, frac: cfg.fertSplit.fruitSet },
      { atGdd: 900, frac: cfg.fertSplit.postVeraison },
    ];

    // --- Леджер балансу (exact) ---
    const led = { cIn: 0, cHeat: 0, cFallOut: 0, nIn: 0, nOut: 0,
      soilIn: FERT.initialN + 0, soilFert: 0, soilMin: 0, soilUp: 0, soilLoss: 0, soilDenit: 0, soilHydr: 0, soilNitr: 0 };
    const cPoolsStart = cLeaf + cShoot + cRoot + cCluster + cBerryStruct + cBerrySugar + cWoodStarch + cRootReserve;
    const nPoolsStart = leafN + otherN + reserveN + nitrateStore + aminoPool + berryN;

    for (let d = 0; d < N_DAYS; d++) {
      const T = dayTemp(cfg, d);
      const ppfd = dayPPFD(cfg, d);
      gdd += Math.max(0, T - 10);
      const phenoIdx = phenologyIndex(gdd, V.phenoShift);
      const stage = PHENO[phenoIdx];
      const alloc = allocPhase(phenoIdx);

      // --- Фенологічні події ---
      if (phenoIdx >= 3 && !fruitSetDone) {
        const bz = Math.min(clamp(cfg.bSupply, 0, 1.5), clamp(cfg.znSupply, 0, 1.5));
        const fruitSetFactor = clamp(0.30 * Math.min(bz, 1.2) + 0.10, 0.05, 0.55);
        berriesCount = Math.round(nClusters * V.berryPerCluster * fruitSetFactor);
        fruitSetDone = true;
      }
      while (fertEvents.length && gdd >= fertEvents[0].atGdd * (1 + V.phenoShift)) {
        const ev = fertEvents.shift();
        const kg = cfg.nFertKgHa * ev.frac;
        led.soilFert += kg;
        if (tier2) {
          if (cfg.fertForm === 'nitrate') soilNo3 += kg;
          else if (cfg.fertForm === 'ammonium') soilNh4 += kg;
          else if (cfg.fertForm === 'urea') soilUrea += kg;
          else { soilNo3 += kg * 0.5; soilNh4 += kg * 0.25; soilUrea += kg * 0.25; }
        } else soilN += kg;
      }

      // --- Фактори ---
      const leafDM = cLeaf / C_FRAC_DM;
      const leafNconc = leafDM > 1 ? leafN / leafDM : N_CONC.leaf;
      const fN = clamp(Math.pow(leafNconc / N_CONC.leaf, 0.6), 0.15, 1.15);
      const fWater = cfg.water >= 0.55 ? 1.0 : clamp(0.25 + (cfg.water - 0.2) / 0.35 * 0.75, 0.15, 1.0);
      const fMg = clamp(cfg.mgSupply, 0.15, 1.0);
      const fP = clamp(cfg.pSupply, 0.2, 1.0);
      const fK = clamp(cfg.kSupply, 0.3, 1.0);
      const fVeg = Math.min(fN, fWater, fMg, fP);
      const leafArea = leafDM * SLA;

      // --- Фотосинтез ---
      let gpp;
      if (tier2) {
        const vcmax25 = 70 * clamp(Math.pow(leafNconc / N_CONC.leaf, 0.7), 0.2, 1.3) * fMg * fP; // Vcmax ← N-Rubisco [зв'язок за літературою, верифікувати]
        const jmax25 = 1.67 * vcmax25;
        gpp = fvcbCanopy(T, ppfd, leafArea, vcmax25, jmax25, fWater);
      } else {
        const interception = 1 - Math.exp(-K_EXT * (leafArea / VINE_AREA_M2));
        gpp = ppfd * interception * 0.85 * fTempPhoto(T) * fVeg;
      }
      led.cIn += gpp;

      // --- Дихання підтримки ---
      const shootDM = cShoot / C_FRAC_DM, rootDM = cRoot / C_FRAC_DM;
      const activeDM = leafDM + shootDM * 0.6 + rootDM * 0.35 + (cBerryStruct / C_FRAC_DM) + (cCluster / C_FRAC_DM);
      const rm = activeDM * RM_BASE * Math.pow(Q10_MAINT, (T - 20) / 10);
      // Дихання підтримки: резерви покривають дефіцит; якщо і їх не вистачає —
      // дихання пригнічується до фактично доступного C (маса зберігається точно).
      let drawnMaint = 0;
      if (gpp < rm) {
        const need = rm - gpp;
        const fromWood = Math.min(cWoodStarch, need * 0.7);
        const fromRoot = Math.min(cRootReserve, need - fromWood);
        cWoodStarch -= fromWood; cRootReserve -= fromRoot;
        drawnMaint = fromWood + fromRoot;
      }
      const heatMaint = Math.min(rm, gpp + drawnMaint);   // фактичне тепло підтримки
      led.cHeat += heatMaint;
      let availC = gpp + drawnMaint - heatMaint;          // ≥ 0 завжди
      // Початковий ріст з резервів (до цвітіння)
      if (phenoIdx <= 3) {
        const subsidy = Math.min(1.6, cWoodStarch + cRootReserve);
        if (subsidy > 0) {
          const fromW = Math.min(cWoodStarch, subsidy * 0.7);
          cWoodStarch -= fromW; cRootReserve -= (subsidy - fromW);
          availC += subsidy;                                  // трансфер усередині системи
        }
      }
      // --- Ґрунтовий N ---
      let uptakeN = 0, nAvail = 0;
      const fTsoil = Math.pow(1.6, (T - 15) / 10);
      if (tier2) {
        // мінералізація → NH₄⁺
        const minKg = FERT.mineralization * fTsoil * fWater;
        soilNh4 += minKg; led.soilMin += minKg;
        // гідроліз сечовини (уреаза)
        soilUrea = Math.max(0, soilUrea);
        const hyd = soilUrea * 0.30 * fTsoil * clamp(fWater, 0.1, 1);
        soilUrea -= hyd; soilNh4 += hyd; led.soilHydr += hyd;
        // нітрифікація NH₄⁺ → NO₃⁻ (тільки з невід'ємного пулу)
        soilNh4 = Math.max(0, soilNh4);
        const nitr = soilNh4 * 0.055 * fTsoil * clamp(fWater, 0.1, 1);
        soilNh4 -= nitr; soilNo3 += nitr; led.soilNitr += nitr;
        // вимивання
        soilNo3 = Math.max(0, soilNo3); soilNh4 = Math.max(0, soilNh4);
        const wet = cfg.water >= 0.7 ? 1.2 : 0.6;
        const leachNo3 = soilNo3 * 0.022 * wet;
        const leachNh4 = soilNh4 * 0.004 * wet;
        soilNo3 -= leachNo3; soilNh4 -= leachNh4;
        led.soilLoss += leachNo3 + leachNh4;
        // денітрифікація (тепло + волого)
        const denit = soilNo3 * 0.006 * fTsoil * (cfg.water >= 0.7 ? 1.3 : 0.7);
        soilNo3 -= denit; led.soilDenit += denit;
        // поглинання NO₃⁻ і NH₄⁺ (Міхаеліс–Ментен окремо)
        const vmaxT = (T) => Math.pow(Q10_MAINT, (T - 20) / 10) * fWater * clamp(rootDM / 350, 0.2, 1.3);
        const no3g = Math.max(0, soilNo3) * KG_HA_TO_G_VINE;
        const nh4g = Math.max(0, soilNh4) * KG_HA_TO_G_VINE;
        const storeRoom = Math.max(0, NITRATE_STORE_CAP - nitrateStore);
        const upNO3 = Math.min(VMAX_NO3 * vmaxT(T) * no3g / (KM_N + no3g), no3g, storeRoom);
        const upNH4 = Math.min(VMAX_NH4 * vmaxT(T) * nh4g / (KM_NH4 + nh4g), nh4g);
        soilNo3 -= upNO3 / KG_HA_TO_G_VINE; soilNh4 -= upNH4 / KG_HA_TO_G_VINE;
        led.soilUp += (upNO3 + upNH4) / KG_HA_TO_G_VINE;
        uptakeN = upNO3 + upNH4;
        // Внутрішній метаболізм N
        nitrateStore += upNO3;
        aminoPool += upNH4;                                  // NH₄⁺ напряму в амінний пул
        // відновлення нітрату: лімітоване C-енергією (Tier 2 — зв'язок C↔N)
        let redCapacity = nitrateStore * K_NITRATE_REDUCT * Math.pow(Q10_MAINT, (T - 20) / 10);
        let redByC = availC > 0 ? availC / NITRATE_REDUCT_COST : 0;
        const red = Math.max(0, Math.min(nitrateStore, redCapacity, redByC));
        nitrateStore -= red; aminoPool += red;
        availC -= red * NITRATE_REDUCT_COST; led.cHeat += red * NITRATE_REDUCT_COST;
        nAvail = aminoPool;                                   // на алокацію
      } else {
        const minKg = FERT.mineralization * fTsoil * fWater;
        soilN += minKg; led.soilMin += minKg;
        const wet = cfg.water >= 0.7 ? 1.2 : 0.6;
        const leach = soilN * 0.018 * wet;
        soilN -= leach; led.soilLoss += leach;
        const soilNg = Math.max(0, soilN) * KG_HA_TO_G_VINE;
        const vmax = 0.15 * Math.pow(Q10_MAINT, (T - 20) / 10) * fWater * clamp(rootDM / 350, 0.2, 1.3);
        uptakeN = soilNg > 0 ? Math.min(vmax * soilNg / (KM_N + soilNg), soilNg) : 0;
        soilN -= uptakeN / KG_HA_TO_G_VINE;
        led.soilUp += uptakeN / KG_HA_TO_G_VINE;
        nAvail = uptakeN;
      }
      led.nIn += uptakeN;

      // --- Ягода: фази росту ---
      const berryFWTarget = berriesCount * V.berryFW_g;
      let scheduleFW = berryFWTotal;
      const gddP1 = PHENO[5].gdd * (1 + V.phenoShift);
      const gddVer = PHENO[7].gdd * (1 + V.phenoShift);
      // Ріст об'єму ягоди — модель Локгарта (спрощено): тургор ∝ забезпеченість водою
      const fBerryWater = phenoIdx >= 5 && phenoIdx <= 6
        ? (0.30 + 0.70 * fWater)     // фаза I: поділ клітин найчутливіший до води
        : (0.55 + 0.45 * fWater);    // фаза III: розширення
      if (phenoIdx >= 5 && phenoIdx <= 6) {
        const t01 = clamp((gdd - gddP1) / (gddVer - gddP1), 0, 1);
        scheduleFW = berryFWTarget * (0.65 * (1 - Math.pow(1 - t01, 2)) + 0.02) * fBerryWater;
      } else if (phenoIdx >= 7) {
        const t03 = clamp((gdd - gddVer) / (420 * (1 + V.phenoShift)), 0, 1);
        scheduleFW = berryFWTarget * (0.65 + 0.35 * t03) * fBerryWater;
      }
      const cBerryBudget = availC * alloc.berry;
      const fwDemand = Math.max(0, scheduleFW - berryFWTotal);
      const cNeedFW = fwDemand * 0.20 * C_FRAC_DM * GROWTH_COST;
      const fwAllowed = cNeedFW > 0 ? Math.min(1, cBerryBudget / cNeedFW) : 1;
      const dBerryFW = fwDemand * fwAllowed;
      berryFWTotal += dBerryFW;
      // --- C: структура ягоди ---
      const depBerry = dBerryFW * 0.20 * C_FRAC_DM;
      const costBerry = depBerry * GROWTH_COST;
      cBerryStruct += depBerry;
      availC -= costBerry;
      led.cHeat += costBerry - depBerry;

      // --- Цукор ---
      let sugarIn = 0;
      if (phenoIdx >= 7 && berryFWTotal > 0) {
        const kgBerries = berryFWTotal / 1000;
        const lfRatio = kgBerries > 0 ? leafArea / kgBerries : 1.2;
        const lfFactor = clamp(lfRatio / 1.0, 0.35, 1.25);
        sugarIn = 6.8 * kgBerries * lfFactor * fK * (tier2 ? fVcmax(T) : fTempPhoto(T)) * fN;
        sugarIn = Math.min(sugarIn, availC / SUGAR_COST / C_FRAC_DM);
        const sugarC = sugarIn * C_FRAC_DM;
        cBerrySugar += sugarC;
        availC -= sugarC * SUGAR_COST;
        led.cHeat += sugarC * (SUGAR_COST - 1);
      }
      const berrySugarG = cBerrySugar / C_FRAC_DM;

      // --- Кислоти ---
      const Lmust = berryFWTotal / 1000;
      if (phenoIdx >= 5 && phenoIdx < 7 && berryFWTotal > 0) {
        berryMalateG = Math.min(MALATE_L * Lmust, berryMalateG + MALATE_L * Lmust * 0.08);
        berryTartrateG = Math.min(TARTRATE_L * Lmust, berryTartrateG + TARTRATE_L * Lmust * 0.10);
      } else if (phenoIdx >= 7 && berryFWTotal > 0) {
        const kMal = K_MAL * Math.pow(Q10_MALATE, (T - 25) / 10);
        berryMalateG = Math.max(0, berryMalateG * (1 - kMal));
      }
      const berryK_L = 1.8 * clamp(cfg.kSupply, 0.3, 1.5);

      // --- Терпеноїди ---
      let synthTotal = 0;
      if (phenoIdx >= 6 && berryFWTotal > 1) {
        const lightCluster = clamp(cfg.canopyExposure * (1 + 0.9 * cfg.leafRemoval), 0.15, 1.35);
        const fLightT = clamp(0.25 + 0.75 * Math.min(lightCluster, 1.1), 0.2, 1.15);
        const fNterp = clamp(1.05 - 0.55 * (leafNconc / N_CONC.leaf - 1), 0.40, 1.10); // надлишок N знижує синтез [напрямок за §3.5 ТЗ]
        const fWaterT = cfg.mildDeficitAfterSet ? 1.18 : (cfg.water < 0.45 ? 0.65 : 1.0);
        // Розбавлення навантаженням: менші ягоди → вища частка шкіри (синтез там) →
        // вища концентрація [напрямок за §3.5 ТЗ: висока навантаженість → розбавлення]
        const kgBerriesNow = berryFWTotal / 1000;
        const fLoad = clamp(Math.pow(2.0 / Math.max(0.2, kgBerriesNow), 0.25), 0.60, 1.30); // ref 2 кг/куш [ASSUMPTION]
        synthTotal = V.terpSynthBase * V.dxsActivity * fLightT * fTempTerpene(T) * fNterp * fWaterT
          * fLoad * kgBerriesNow;
        if (tier2) {
          // MEP-мережа: DXS → GPP → синтази окремих сполук; окиснення; глікозилювання
          for (const comp of Object.keys(V.terpProfile)) {
            terpF[comp] += synthTotal * V.terpProfile[comp];
          }
          // окиснення ліналоолу → оксиди (хімічне, швидше при спеки)
          const ox = terpF.linalool * (0.006 + (T > 30 ? (T - 30) * 0.004 : 0));
          terpF.linalool -= ox; terpF.oxides += ox;
          // глікозилювання окремих сполук (ензиматика T-залежна)
          const fEnz = 0.25 + 0.75 * fTempTerpene(T);
          for (const comp of Object.keys(terpF)) {
            const gly = terpF[comp] * GLY_COMPOUND[comp] * fEnz;
            terpF[comp] -= gly; terpB[comp] += gly;
          }
          // втрати вільних (окиснення/випаровування)
          for (const comp of Object.keys(terpF)) {
            const loss = terpF[comp] * (LOSS_BASE * fEnz + (T > 26.5 ? Math.pow(T - 26.5, 1.5) * 0.012 : 0)); // [FIXED E7 QA: суперлінійні втрати >32 °C]
            terpF[comp] -= loss;
          }
        } else {
          terpFreeT1 += synthTotal;
          const fEnz = 0.25 + 0.75 * fTempTerpene(T);
          const gly = terpFreeT1 * GLY_RATE * fEnz;
          terpFreeT1 -= gly; terpBoundT1 += gly;
          const loss = terpFreeT1 * (LOSS_BASE * fEnz + (T > 26.5 ? Math.pow(T - 26.5, 1.5) * 0.012 : 0));
          terpFreeT1 -= loss;
        }
      }

      // --- Алокація C: структурні органи ---
      const laiCapLeafArea = V.laiMax * VINE_AREA_M2 * fVeg;
      const cForStruct = availC / GROWTH_COST;
      const dmNew = { leaf: 0, shoot: 0, root: 0, reserve: 0, cluster: 0 };
      const dmPot = {
        leaf: cForStruct * alloc.leaf / C_FRAC_DM,
        shoot: cForStruct * alloc.shoot / C_FRAC_DM,
        root: cForStruct * alloc.root / C_FRAC_DM,
        cluster: cForStruct * alloc.cluster / C_FRAC_DM,
        reserve: cForStruct * alloc.reserve / C_FRAC_DM,
      };
      dmNew.leaf = leafArea >= laiCapLeafArea ? 0 : Math.min(dmPot.leaf, (laiCapLeafArea - leafArea) / SLA);
      dmNew.shoot = dmPot.shoot; dmNew.root = dmPot.root;
      dmNew.cluster = dmPot.cluster; dmNew.reserve = dmPot.reserve;
      let depStruct = 0;
      const putC = (pool, dm) => { const dep = dm * C_FRAC_DM; pool += dep; depStruct += dep; return pool; };
      cLeaf = putC(cLeaf, dmNew.leaf);
      cShoot = putC(cShoot, dmNew.shoot);
      cRoot = putC(cRoot, dmNew.root);
      cCluster = putC(cCluster, dmNew.cluster);
      availC -= depStruct * GROWTH_COST;
      led.cHeat += depStruct * (GROWTH_COST - 1);
      // невитрачений C → резерви (трансфер)
      if (availC > 0) {
        cWoodStarch += availC * 0.7; cRootReserve += availC * 0.3;
        availC = 0;
      }

      // --- N-алокація ---
      const nDemand = dmNew.leaf * N_CONC.leaf + dmNew.shoot * N_CONC.shoot + dmNew.root * N_CONC.root
        + dmNew.cluster * N_CONC.berry * 0.5 + dmNew.reserve * N_CONC.wood
        + (phenoIdx >= 5 && phenoIdx < 9 && berryFWTotal > 0 ? dBerryFW * 0.20 * N_CONC.berry : 0);
      // Джерела N: амінний пул (tier2) / свіжий uptake (tier1); за потреби — резервний N.
      // Витрачаємо лише nDemand; залишок амінного пулу зберігається до наступної доби.
      const fromBucket = tier2 ? Math.min(aminoPool, nDemand) : Math.min(uptakeN, nDemand);
      const draw = Math.min(reserveN, Math.max(0, nDemand - fromBucket));
      if (tier2) aminoPool -= fromBucket;                 // трансфер: амінний пул → органи
      reserveN -= draw;                                  // трансфер: резерв → органи
      const nSpend = fromBucket + draw;
      const berryNDemand = (phenoIdx >= 5 && phenoIdx < 9 && berryFWTotal > 0) ? dBerryFW * 0.20 * N_CONC.berry : 0;
      const nToLeaf = nDemand > 0 ? nSpend * (dmNew.leaf * N_CONC.leaf) / nDemand : 0;
      const nToBerry = nDemand > 0 ? nSpend * berryNDemand / nDemand : 0;
      const nToOther = Math.max(0, nSpend - nToLeaf - nToBerry);
      leafN += nToLeaf; berryN += nToBerry;
      otherN += nToOther * 0.55; reserveN += nToOther * 0.45;
      // Tier 1: невитрачений свіжий uptake йде у сховище (пул-трансфер)
      if (!tier2) {
        const rest = uptakeN - fromBucket;
        otherN += rest * 0.55; reserveN += rest * 0.45;
      }
      // Tier 2: «розкішне» накопичення N у листі (luxury uptake) — надлишок
      // азоту підвищує листовий N понад оптимум → ↓ терпеноїди, ↑ вегетація [літературний напрямок, §3.5 ТЗ]
      if (tier2) {
        const luxury = Math.min(Math.max(0, aminoPool - nDemand), nDemand * 0.30);
        aminoPool -= luxury;
        leafN += luxury * 0.6; reserveN += luxury * 0.4;
      }
      // N-статус насичення (для YAN-проксі)
      const nSat = clamp(nDemand > 0 ? nSpend / nDemand : 1, 0, 1);
      cumNSpend += nSpend; cumNDemand += nDemand;

      // --- Листопад: ремобілізація N ---
      if (phenoIdx >= 9 && leafDM > 0) {
        const drop = leafDM * 0.020;
        const nDrop = drop * (leafDM > 1 ? leafN / leafDM : N_CONC.leaf);
        cLeaf -= drop * C_FRAC_DM;
        leafN -= nDrop;
        const nRemob = nDrop * 0.7;
        reserveN += nRemob;
        led.nOut += nDrop * 0.3;
        led.cFallOut += drop * C_FRAC_DM;
      }

      // --- Показники дня ---
      const brix = berryFWTotal > 0 ? berrySugarG / berryFWTotal * 100 : 0;
      const ta = Lmust > 0 ? (berryTartrateG + berryMalateG * (150 / 134)) / Lmust : 0;
      const pH = clamp(3.05 + 0.25 * Math.log10(clamp(berryK_L, 0.4, 4) / 1.8) + 0.05 * (7.5 - clamp(ta, 3, 12)), 2.85, 4.0);
      let freeUg = 0, boundUg = 0;
      const compOut = {};
      if (tier2) {
        for (const comp of Object.keys(terpF)) {
          const f = Lmust > 0 ? terpF[comp] / Lmust : 0;
          const b = Lmust > 0 ? terpB[comp] / Lmust : 0;
          compOut[comp] = { free: f, bound: b };
          freeUg += f; boundUg += b;
        }
      } else {
        freeUg = Lmust > 0 ? terpFreeT1 / Lmust : 0;
        boundUg = Lmust > 0 ? terpBoundT1 / Lmust : 0;
      }
      // Індекс мускатності: OAV-зважений (вільні/пороги одоряції), нормовано 0–100 [ASSUMPTION]
      let oavSum = 0;
      for (const comp of Object.keys(ODOR_THRESHOLD)) {
        const v = compOut[comp] ? compOut[comp].free : (comp === 'oxides' ? 0 : freeUg * (V.terpProfile[comp] || 0));
        oavSum += v / ODOR_THRESHOLD[comp];
      }
      const muscatIndex = tier2 ? clamp(100 * oavSum / (oavSum + 4), 0, 100) : clamp(freeUg / 7, 0, 100);

      res.daily.push({
        day: d, date: dayToDate(d), T, ppfd, gdd, bbch: stage.bbch, stageLabel: stage.label, phenoIdx,
        leafDM, shootDM, rootDM, clusterDM: cCluster / C_FRAC_DM, berryDM: cBerryStruct / C_FRAC_DM,
        leafArea, lai: leafArea / VINE_AREA_M2,
        gpp, rm, availC: Math.max(0, availC),
        soilN: tier2 ? (soilNo3 + soilNh4 + soilUrea) : soilN,
        soilNo3, soilNh4, soilUrea,
        uptakeN, leafNconc, nSat, cumNSpend, cumNDemand,
        berryFWTotal, berrySugarG, brix, ta, pH, berryMalateG, berryTartrateG, berryK_L,
        terpFreeUg: freeUg, terpBoundUg: boundUg, terpTotalUg: freeUg + boundUg,
        terpCompounds: compOut, muscatIndex,
        yieldKg: berryFWTotal / 1000,
        factors: {
          light: clamp(cfg.parFactor, 0.5, 1.4),
          temp: tier2 ? fVcmax(T) : fTempPhoto(T),
          nitrogen: fN, water: fWater, phosphorus: fP, potassium: fK, magnesium: fMg,
        },
      });

      if (phenoIdx >= 7 && harvestDay === null && brix >= V.targetBrix) { harvestDay = d; break; }
    }

    // ---------- Підсумки ----------
    const harvest = harvestDay !== null ? res.daily[harvestDay] : res.daily[res.daily.length - 1];
    const cumNSat = harvest.cumNDemand > 0 ? harvest.cumNSpend / harvest.cumNDemand : 1;
    const yan = clamp(40 + 210 * cumNSat, 40, 350);  // YAN-проксі, мг N/л [ASSUMPTION: 50–350]
    let compSummary = null, ratioLG = null;
    if (harvest.terpCompounds && Object.keys(harvest.terpCompounds).length) {
      compSummary = harvest.terpCompounds;
      ratioLG = harvest.terpCompounds.geraniol.free > 0
        ? harvest.terpCompounds.linalool.free / harvest.terpCompounds.geraniol.free : null;
    }
    res.summary = {
      tier: cfg.tier,
      harvestDay: harvestDay !== null ? harvestDay : N_DAYS - 1,
      harvestDate: harvest.date, bbchAtHarvest: harvest.bbch,
      yieldKgPerVine: harvest.berryFWTotal / 1000,
      yieldTPerHa: (harvest.berryFWTotal / 1000) * DENSITY_VINES_HA / 1000,
      brix: harvest.brix, ta: harvest.ta, ph: harvest.pH, yan,
      terpFreeUg: harvest.terpFreeUg, terpBoundUg: harvest.terpBoundUg, terpTotalUg: harvest.terpTotalUg,
      terpCompounds: compSummary, linaloolGeraniolRatio: ratioLG,
      muscatIndex: harvest.muscatIndex,
      maxLai: Math.max(...res.daily.map(x => x.lai)),
      gddSeason: harvest.gdd, variety: V.name,
    };

    // ---------- Баланс (ворота G3/G5) ----------
    const cPoolsEnd = cLeaf + cShoot + cRoot + cCluster + cBerryStruct + cBerrySugar + cWoodStarch + cRootReserve;
    const cBalance = (led.cIn - led.cHeat - led.cFallOut) - (cPoolsEnd - cPoolsStart);
    const nPoolsEnd = leafN + otherN + reserveN + nitrateStore + aminoPool + berryN;
    const nBalance = (led.nIn - led.nOut) - (nPoolsEnd - nPoolsStart);
    const soilEnd = tier2 ? (soilNo3 + soilNh4 + soilUrea) : soilN;
    const soilStart = FERT.initialN;
    const soilBalance = (soilStart + led.soilFert + led.soilMin + led.soilHydr + led.soilNitr)
      - (soilEnd + led.soilUp + led.soilLoss + led.soilDenit + led.soilNitr + led.soilHydr);
    res.balance = {
      cLedger: led,
      cPoolsStart, cPoolsEnd, cBalance,
      nPoolsStart, nPoolsEnd, nBalance,
      soilStart, soilEnd, soilBalance,
      cClosureRel: Math.abs(cBalance) / Math.max(1, led.cIn),
      nClosureRel: Math.abs(nBalance) / Math.max(1e-9, led.nIn),
      soilClosure: Math.abs(soilBalance) / Math.max(1, soilStart + led.soilFert),
      // верифікація (використовується validation/mass_balance.js):
      pass: Math.abs(cBalance) / Math.max(1, led.cIn) <= 1e-6
        && Math.abs(nBalance) / Math.max(1e-9, led.nIn) <= 1e-6
        && Math.abs(soilBalance) / Math.max(1, soilStart + led.soilFert) <= 1e-6,
    };
    return res;
  }

  // ---------- Чутливість (±20%, one-at-a-time) ----------
  function sensitivity(cfg, keys, targetFn) {
    const base = targetFn(simulate(cfg));
    const out = [];
    for (const k of keys) {
      const minus = Object.assign({}, cfg); minus[k] = cfg[k] * 0.8;
      const plus = Object.assign({}, cfg); plus[k] = cfg[k] * 1.2;
      out.push({ key: k, minus: targetFn(simulate(minus)) - base, plus: targetFn(simulate(plus)) - base, base });
    }
    return out;
  }

  return { simulate, sensitivity, defaultConfig, VARIETIES, TEMP_SCENARIOS, SOIL_FERTILITY, PHENO, ODOR_THRESHOLD };
})();
