/**
 * Grapevine Season Model — Tier 1 (балансова модель сезону виноградного куща)
 * Vitis vinifera L., акцент на мускатні сорти (монотерпеноли: вільні + глікозидно-зв'язані).
 *
 * Дизайн: добовий крок; пули C і N по органах (листя, пагони, коріння,
 * багаторічна деревина + резерви, грона/ягоди); фенологія BBCH через GDD (база 10 °C);
 * фотосинтез — спрощена добова продуктивність (FvCB-агрегат: світло × температура ×
 * N-статус × вода × Mg); ягода — подвійна сигмоїда, Brix/TA/pH; терпеноїди —
 * синтез (MEP-проксі) → глікозилювання → втрати.
 *
 * Одиниці: г сухої маси (DM), г C, г N на куш; температура °C; PPFD моль·м⁻²·доба⁻¹;
 * добрива кг/га (перерахунок через щільність посадки). Кожен параметр має позначку
 * джерела/ASSUMPTION у model_spec/parameters.yaml.
 */
'use strict';

const VineModel = (function () {
  // ---------- Константи ----------
  const N_DAYS = 214;              // 1 квітня — 31 жовтня
  const VINE_AREA_M2 = 2.2;        // площа живлення одного куша, м² [ASSUMPTION: 2.5 м × 0.9 м ≈ 4000 кущів/га]
  const DENSITY_VINES_HA = 10000 / VINE_AREA_M2;
  const KG_HA_TO_G_VINE = 1000 / DENSITY_VINES_HA; // 1 кг/га = X г/куш
  const C_FRAC_DM = 0.45;          // г C / г DM [ASSUMPTION: типовий діапазон 0.42–0.50]
  const GROWTH_COST = 1.4;         // г C асиміляту на 1 г C нової структури [Penning de Vries-типу, ASSUMPTION]
  const Q10_MAINT = 2.0;           // Q10 дихання підтримки [ASSUMPTION: стартове]
  const Q10_MALATE = 2.1;          // Q10 дихання малату після véraison [ASSUMPTION]
  const SLA = 0.02;                 // м² листя / г DM (SLA ≈ 20 м²/кг) [ASSUMPTION]
  const K_EXT = 0.7;               // коефіцієнт екстинкції світла в кроні [ASSUMPTION: типовий для виноградника]
  const EPS0 = 0.85;               // г C на моль перехопленого PPFD в оптимумі [ASSUMPTION: калібрувальний]
  const RM_BASE = 0.006;           // г C·г⁻¹ DM·доба⁻¹ дихання підтримки при 20 °C [ASSUMPTION: ~40–50% GPP]
  const KM_N = 0.05;               // г N/куш: константа Міхаеліса поглинання N [ASSUMPTION]
  const VMAX_N = 0.15;             // г N/куш/доба при 20 °C [ASSUMPTION: ~25–35 г N за сезон]
  // Родючість ґрунту: стартовий мінеральний N (кг/га) та швидкість мінералізації (кг/га/доба при 15 °C)
  const SOIL_FERTILITY = {
    poor:   { name: 'Бідний',   initialN: 12, mineralization: 0.15 },
    medium: { name: 'Середній', initialN: 30, mineralization: 0.35 },
    rich:   { name: 'Родючий',  initialN: 55, mineralization: 0.65 },
  };
  const N_CONC = { leaf: 0.024, shoot: 0.010, root: 0.013, wood: 0.004, berry: 0.006 }; // г N/г DM [ASSUMPTION: діапазони за Vitis]
  const MALATE_L = 12;            // г/л малату при накопиченні до véraison [розділ 8 ТЗ, орієнтир]
  const TARTRATE_L = 10;          // г/л тартрату [розділ 8 ТЗ, орієнтир]
  const GLY_RATE = 0.045;          // частка вільних → зв'язані за добу [ASSUMPTION]
  const LOSS_BASE = 0.008;        // базові втрати вільних терпенів за добу [ASSUMPTION]

  // ---------- Сорти ----------
  const VARIETIES = {
    muscat_blanc: {
      name: 'Мускат білий (дрібноягідний)',
      berryFW_g: 1.3, dxsActivity: 1.00, terpSynthBase: 45, phenoShift: 0.00,
      targetBrix: 20.5, laiMax: 3.0, berryPerCluster: 110, clustersPerShoot: 1.7,
    },
    muscat_alexandria: {
      name: 'Мускат Александрійський',
      berryFW_g: 2.4, dxsActivity: 0.72, terpSynthBase: 30, phenoShift: 0.06,
      targetBrix: 19.5, laiMax: 2.7, berryPerCluster: 95, clustersPerShoot: 1.5,
    },
    muscat_ottonel: {
      name: 'Мускат Оттонель',
      berryFW_g: 1.9, dxsActivity: 0.55, terpSynthBase: 23, phenoShift: -0.03,
      targetBrix: 20.0, laiMax: 2.8, berryPerCluster: 100, clustersPerShoot: 1.4,
    },
    muscat_hamburg: {
      name: 'Мускат гамбурзький (червоний)',
      berryFW_g: 2.2, dxsActivity: 0.62, terpSynthBase: 27, phenoShift: 0.04,
      targetBrix: 19.0, laiMax: 2.9, berryPerCluster: 105, clustersPerShoot: 1.5,
    },
  };

  // ---------- Погода ----------
  const TEMP_SCENARIOS = {
    cold:    { name: 'Холодний',  monthlyT: [8.5, 13.5, 16.5, 17.5, 14.5, 11.0, 7.5] },  // квітень..жовтень
    typical: { name: 'Типовий',   monthlyT: [10.5, 15.5, 19.5, 21.5, 17.5, 13.5, 9.0] },
    hot:     { name: 'Спекотний', monthlyT: [12.5, 17.5, 22.5, 25.0, 20.5, 15.5, 11.0] },
  };
  const MONTH_PPFD = [26, 33, 40, 41, 35, 26, 18]; // моль·м⁻²·доба⁻¹ [ASSUMPTION: помірний клімат]

  // ---------- Фенологія BBCH (GDD, база 10 °C) ----------
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

  // ---------- Алокація вуглецю за фазами ----------
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
      variety: 'muscat_blanc',
      soilFertility: 'medium',
      tempScenario: 'typical',
      dT: 0, parFactor: 1.0, water: 0.75,
      mildDeficitAfterSet: false,
      nFertKgHa: 60,
      fertSplit: { preBloom: 0.30, fruitSet: 0.40, postVeraison: 0.30 },
      pSupply: 1.0, kSupply: 1.0, mgSupply: 1.0, bSupply: 1.0, znSupply: 1.0,
      buds: 22, leafRemoval: 0.0, canopyExposure: 0.75,
    };
  }

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, t) => a + (b - a) * t;

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
  // Дзвоноподібна температурна відповідь фотосинтезу (Topt ≈ 26 °C)
  function fTempPhoto(T) {
    const Topt = 26, Tlow = 8, Thigh = 38;
    if (T <= Tlow || T >= Thigh) return 0.05;
    if (T <= Topt) return 0.35 + 0.65 * (T - Tlow) / (Topt - Tlow);
    return 0.35 + 0.65 * (Thigh - T) / (Thigh - Topt);
  }
  // Температурний фактор синтезу терпенів: оптимум 22–28 °C, >35 °C — різке падіння
  function fTempTerpene(T) {
    if (T < 12) return 0.10;
    if (T <= 28) return 0.20 + 0.80 * (T - 12) / 16;
    if (T <= 35) return 1.0 - (T - 28) * 0.05;
    return clamp(0.65 - (T - 35) * 0.08, 0, 0.65);
  }
  function phenologyIndex(gdd, shift) {
    let idx = 0;
    for (let i = 0; i < PHENO.length; i++) if (gdd >= PHENO[i].gdd * (1 + shift)) idx = i;
    return idx;
  }
  function allocPhase(idx) {
    if (idx <= 2) return ALLOC.veg;
    if (idx === 3) return ALLOC.bloom;
    if (idx === 4 || idx === 5) return ALLOC.fruit;
    if (idx === 6) return ALLOC.fruit;    // лаг-фаза: продовжуємо fruit
    if (idx === 7) return ALLOC.veraison;
    if (idx === 8) return ALLOC.ripen;
    return ALLOC.autumn;
  }

  // ================= Головна симуляція =================
  function simulate(userCfg) {
    const cfg = Object.assign(defaultConfig(), userCfg || {});
    const V = VARIETIES[cfg.variety];
    const res = { daily: [], summary: {}, balance: {}, cfg };

    // --- Початковий стан (на куш) ---
    let leafDM = 0, shootDM = 20, rootDM = 350, berryDM = 0, clusterDM = 0;
    let leafN = 0, shootN = 2, rootN = 4.5;
    let woodStarchC = 90, woodReserveN = 2.0, rootReserveC = 25, rootReserveN = 0.6;
    let berrySugarC = 0, berryMalateG = 0, berryTartrateG = 0;
    let terpFree = 0, terpBound = 0;     // мкг на куш
    let berryFWTotal = 0;                // г свіжої маси ягід на куш
    const FERT = SOIL_FERTILITY[cfg.soilFertility] || SOIL_FERTILITY.medium;
    let soilN = FERT.initialN;              // кг мінерального N/га
    let gdd = 0, berriesCount = 0, harvestDay = null;
    const nClusters = cfg.buds * V.clustersPerShoot;
    let fruitSetDone = false;

    const fertEvents = [
      { atGdd: 250, frac: cfg.fertSplit.preBloom },
      { atGdd: 500, frac: cfg.fertSplit.fruitSet },
      { atGdd: 900, frac: cfg.fertSplit.postVeraison },
    ];

    // Балансові лічильники
    let cIn = 0, cOut = 0, nIn = 0, nOut = 0;

    for (let d = 0; d < N_DAYS; d++) {
      const T = dayTemp(cfg, d);
      const ppfd = dayPPFD(cfg, d);
      gdd += Math.max(0, T - 10);
      const phenoIdx = phenologyIndex(gdd, V.phenoShift);
      const stage = PHENO[phenoIdx];
      const alloc = allocPhase(phenoIdx);

      // --- Події ---
      if (phenoIdx >= 3 && !fruitSetDone) {
        const bz = Math.min(clamp(cfg.bSupply, 0, 1.5), clamp(cfg.znSupply, 0, 1.5));
        const fruitSetFactor = clamp(0.30 * Math.min(bz, 1.2) + 0.10, 0.05, 0.55);
        berriesCount = Math.round(nClusters * V.berryPerCluster * fruitSetFactor);
        fruitSetDone = true;
      }
      while (fertEvents.length && gdd >= fertEvents[0].atGdd * (1 + V.phenoShift)) {
        soilN += cfg.nFertKgHa * fertEvents.shift().frac;
      }

      // --- N-статус листя ---
      const leafNconc = leafDM > 1 ? leafN / leafDM : N_CONC.leaf;
      const fN = clamp(Math.pow(leafNconc / N_CONC.leaf, 0.6), 0.15, 1.15);
      const fWater = cfg.water >= 0.55 ? 1.0 : clamp(0.25 + (cfg.water - 0.2) / 0.35 * 0.75, 0.15, 1.0);
      const fMg = clamp(cfg.mgSupply, 0.15, 1.0);
      const fP = clamp(cfg.pSupply, 0.2, 1.0);
      const fK = clamp(cfg.kSupply, 0.3, 1.0);
      const fVeg = Math.min(fN, fWater, fMg, fP);

      // --- Фотосинтез ---
      const leafArea = leafDM * SLA;
      const lai = leafArea / VINE_AREA_M2;
      const interception = 1 - Math.exp(-K_EXT * lai);
      const gpp = ppfd * interception * EPS0 * fTempPhoto(T) * fVeg;
      cIn += gpp;

      // --- Дихання підтримки ---
      const activeDM = leafDM + shootDM + rootDM * 0.5 + berryDM + clusterDM;
      const rm = activeDM * RM_BASE * Math.pow(Q10_MAINT, (T - 20) / 10);
      let availC = gpp - rm;
      cOut += rm;
      if (availC < 0) {
        // Резерви покривають дефіцит дихання ранньою весною
        const need = -availC;
        const fromWood = Math.min(woodStarchC, need * 0.7);
        const fromRoot = Math.min(rootReserveC, need - fromWood);
        woodStarchC -= fromWood; rootReserveC -= fromRoot;
        cOut += fromWood + fromRoot;
        availC = 0;
      }
      // Початковий ріст пагонів/листя фінансується резервами (до цвітіння):
      // поки асиміляції не вистачає, резерв дає до 1.6 г C/добу на ріст [ASSUMPTION]
      if (phenoIdx <= 3) {
        const subsidy = Math.min(1.6, woodStarchC + rootReserveC);
        if (subsidy > 0) {
          const fromW = Math.min(woodStarchC, subsidy * 0.7);
          woodStarchC -= fromW; rootReserveC -= (subsidy - fromW);
          availC += subsidy;
          cOut += 0; // C лишається в системі (переходить у біомасу)
        }
      }
      if (availC < 0) availC = 0; // після вичерпання резервів: голодання, ріст зупиняється

      // --- Ягода: фази росту (подвійна сигмоїда) ---
      const berryFWTarget = berriesCount * V.berryFW_g;
      let scheduleFW = berryFWTotal;
      const gddP1 = PHENO[5].gdd * (1 + V.phenoShift);
      const gddVer = PHENO[7].gdd * (1 + V.phenoShift);
      if (phenoIdx >= 5 && phenoIdx <= 6) {
        const t01 = clamp((gdd - gddP1) / (gddVer - gddP1), 0, 1);
        scheduleFW = berryFWTarget * (0.65 * (1 - Math.pow(1 - t01, 2)) + 0.02);
      } else if (phenoIdx >= 7) {
        const t03 = clamp((gdd - gddVer) / (420 * (1 + V.phenoShift)), 0, 1);
        scheduleFW = berryFWTarget * (0.65 + 0.35 * t03);
      }
      // Вуглецеве обмеження росту ягоди: доступний C на ягоду
      const cBerryBudget = availC * alloc.berry;
      const fwDemand = Math.max(0, scheduleFW - berryFWTotal);
      const cNeedFW = fwDemand * 0.20 * C_FRAC_DM * GROWTH_COST;   // DM = 20% FW
      const fwAllowed = cNeedFW > 0 ? Math.min(1, cBerryBudget / cNeedFW) : 1;
      const dBerryFW = fwDemand * fwAllowed;
      berryFWTotal += dBerryFW;
      const cBerryUsed = dBerryFW * 0.20 * C_FRAC_DM * GROWTH_COST;
      availC -= cBerryUsed;

      // --- Цукор у ягоду (після véraison) ---
      let sugarIn = 0;
      if (phenoIdx >= 7 && berryFWTotal > 0) {
        const kgBerries = berryFWTotal / 1000;
        const lfRatio = kgBerries > 0 ? leafArea / kgBerries : 1.2;   // м² листя на кг ягід
        const lfFactor = clamp(lfRatio / 1.0, 0.35, 1.25);           // оптимум ~1 м²/кг [ASSUMPTION]
        sugarIn = 6.8 * kgBerries * lfFactor * fK * fTempPhoto(T) * fN; // г цукру/добу на куш [калібрувальний]
        sugarIn = Math.min(sugarIn, availC * 0.6 / C_FRAC_DM);       // обмеження доступним C
        const sugarC = sugarIn * C_FRAC_DM;
        berrySugarC += sugarC;
        availC -= sugarC;
        cOut += 0;
      }
      const berrySugarG = berrySugarC / C_FRAC_DM;

      // --- Кислоти ---
      const Lmust = berryFWTotal / 1000;             // л сусла ≈ кг ягід
      if (phenoIdx >= 5 && phenoIdx < 7 && berryFWTotal > 0) {
        berryMalateG = Math.min(MALATE_L * Lmust, berryMalateG + MALATE_L * Lmust * 0.08);
        berryTartrateG = Math.min(TARTRATE_L * Lmust, berryTartrateG + TARTRATE_L * Lmust * 0.10);
      } else if (phenoIdx >= 7 && berryFWTotal > 0) {
        const kMal = 0.07 * Math.pow(Q10_MALATE, (T - 25) / 10);
        berryMalateG = Math.max(0, berryMalateG * (1 - kMal));      // дихальне споживання малату
        // тартрат не метаболізується — тільки розбавляється об'ємом
      }
      const berryK_L = 1.8 * clamp(cfg.kSupply, 0.3, 1.5);          // г K/л [ASSUMPTION: 1.5–2.5 г/л]

      // --- Терпеноїди ---
      if (phenoIdx >= 6 && berryFWTotal > 1) {
        const lightCluster = clamp(cfg.canopyExposure * (1 + 0.9 * cfg.leafRemoval), 0.15, 1.35);
        const fLightT = clamp(0.25 + 0.75 * Math.min(lightCluster, 1.1), 0.2, 1.15);
        const fNterp = clamp(1.25 - 0.45 * (leafNconc / N_CONC.leaf - 1), 0.35, 1.2);
        const fWaterT = cfg.mildDeficitAfterSet ? 1.18 : (cfg.water < 0.45 ? 0.65 : 1.0);
        const synth = V.terpSynthBase * V.dxsActivity * fLightT * fTempTerpene(T) * fNterp * fWaterT * (berryFWTotal / 1000);
        terpFree += synth;
        const fEnz = 0.25 + 0.75 * fTempTerpene(T);          // ензиматика сповільнюється на холоді [ASSUMPTION]
        const gly = terpFree * GLY_RATE * fEnz;
        terpFree -= gly; terpBound += gly;
        const loss = terpFree * (LOSS_BASE * fEnz + (T > 32 ? (T - 32) * 0.012 : 0));
        terpFree -= loss;
        if (T > 38) terpBound *= 0.985;
      }

      // --- Ріст структурних органів ---
      const cForStruct = availC / GROWTH_COST;
      const laiCapLeafArea = V.laiMax * VINE_AREA_M2 * fVeg;
      const dmNew = { leaf: 0, shoot: 0, root: 0, reserve: 0, cluster: 0 };
      const dmPot = {
        leaf: cForStruct * alloc.leaf / C_FRAC_DM,
        shoot: cForStruct * alloc.shoot / C_FRAC_DM,
        root: cForStruct * alloc.root / C_FRAC_DM,
        cluster: cForStruct * alloc.cluster / C_FRAC_DM,
        reserve: cForStruct * alloc.reserve / C_FRAC_DM,
      };
      dmNew.leaf = leafArea >= laiCapLeafArea ? 0 : Math.min(dmPot.leaf, (laiCapLeafArea - leafArea) / SLA);
      dmNew.shoot = dmPot.shoot;
      dmNew.root = dmPot.root;
      dmNew.cluster = dmPot.cluster;
      dmNew.reserve = dmPot.reserve;
      const cStructUsed = (dmNew.leaf + dmNew.shoot + dmNew.root + dmNew.cluster + dmNew.reserve) * C_FRAC_DM;
      cOut += cStructUsed * (GROWTH_COST - 1); // дихання росту
      // запас у деревині/корінні (C)
      woodStarchC += dmNew.reserve * C_FRAC_DM * 0.7;
      rootReserveC += dmNew.reserve * C_FRAC_DM * 0.3;

      // --- Ґрунтовий N ---
      const minRate = FERT.mineralization * Math.pow(1.6, (T - 15) / 10) * fWater;   // кг N/га/доба мінералізації [ASSUMPTION]
      soilN += minRate;
      const leach = soilN * 0.018 * (cfg.water >= 0.7 ? 1.2 : 0.6); // вимивання [ASSUMPTION]
      soilN -= leach;
      nOut += leach;

      // --- Поглинання N (Міхаеліс–Ментен) ---
      const soilNgVine = Math.max(0, soilN) * KG_HA_TO_G_VINE;
      const vmaxN = VMAX_N * Math.pow(Q10_MAINT, (T - 20) / 10) * fWater * clamp(rootDM / 350, 0.2, 1.3);
      const uptakeN = soilNgVine > 0 ? Math.min(vmaxN * soilNgVine / (KM_N + soilNgVine), soilNgVine) : 0;
      soilN -= uptakeN / KG_HA_TO_G_VINE;
      nIn += uptakeN;
      let nAvail = uptakeN;

      // --- N-алокація: попит нової біомаси + підтримання концентрацій ---
      const nDemand = dmNew.leaf * N_CONC.leaf + dmNew.shoot * N_CONC.shoot + dmNew.root * N_CONC.root
        + dmNew.cluster * N_CONC.berry * 0.5 + dmNew.reserve * N_CONC.wood;
      if (nAvail < nDemand) {
        const fromRes = Math.min(woodReserveN + rootReserveN, nDemand - nAvail);
        const fromW = Math.min(woodReserveN, fromRes * 0.6);
        woodReserveN -= fromW;
        rootReserveN -= (fromRes - fromW);
        nAvail += fromRes;
      }
      const fracLeaf = nDemand > 0 ? (dmNew.leaf * N_CONC.leaf) / nDemand : 0;
      const nToLeaf = nAvail * fracLeaf;
      leafN += nToLeaf;
      const nRest = nAvail - nToLeaf;
      shootN += nRest * 0.15; rootN += nRest * 0.25;
      woodReserveN += nRest * 0.45; rootReserveN += nRest * 0.15;

      // --- Оновлення DM ---
      leafDM += dmNew.leaf; shootDM += dmNew.shoot; rootDM += dmNew.root; clusterDM += dmNew.cluster;
      berryDM = berryFWTotal * 0.20;

      // --- Листопад: ремобілізація N ---
      if (phenoIdx >= 9 && leafDM > 0) {
        const drop = leafDM * 0.020;
        const nDrop = drop * (leafDM > 1 ? leafN / leafDM : N_CONC.leaf); // весь N опалого листя
        leafDM -= drop;
        leafN -= nDrop;
        const nRemob = nDrop * 0.7;          // 70% N ремобілізується в деревину
        woodReserveN += nRemob;
        nOut += nDrop * 0.3;                 // 30% йде з опадим у ґрунт
        cOut += drop * C_FRAC_DM;            // опад C
      }

      // --- Показники дня ---
      const brix = berryFWTotal > 0 ? berrySugarG / berryFWTotal * 100 : 0;
      const ta = Lmust > 0 ? (berryTartrateG + berryMalateG * (150 / 134)) / Lmust : 0; // г/л екв. винної [MW-перерахунок]
      const pH = clamp(3.05 + 0.25 * Math.log10(clamp(berryK_L, 0.4, 4) / 1.8) + 0.05 * (7.5 - clamp(ta, 3, 12)), 2.85, 4.0); // Henderson–Hasselbalch-агрегат [ASSUMPTION]
      const freeUg = Lmust > 0 ? terpFree / Lmust : 0;
      const boundUg = Lmust > 0 ? terpBound / Lmust : 0;

      res.daily.push({
        day: d, date: dayToDate(d), T, ppfd, gdd, bbch: stage.bbch, stageLabel: stage.label, phenoIdx,
        leafDM, shootDM, rootDM, clusterDM, berryDM, leafArea, lai,
        gpp, rm, availC, soilN, uptakeN, leafNconc,
        berryFWTotal, berrySugarG, brix, ta, pH, berryMalateG, berryTartrateG, berryK_L,
        terpFreeUg: freeUg, terpBoundUg: boundUg, terpTotalUg: freeUg + boundUg,
        yieldKg: berryFWTotal / 1000,
        factors: {
          light: clamp(cfg.parFactor, 0.5, 1.4), temp: fTempPhoto(T),
          nitrogen: fN, water: fWater, phosphorus: fP, potassium: fK, magnesium: fMg,
        },
      });

      if (phenoIdx >= 8 && harvestDay === null && brix >= V.targetBrix) {
        harvestDay = d;
        break;
      }
    }

    // ---------- Підсумки ----------
    const harvest = harvestDay !== null ? res.daily[harvestDay] : res.daily[res.daily.length - 1];
    const yan = harvest.berryDM > 0 ? (harvest.berryDM * N_CONC.berry) / (harvest.berryFWTotal / 1000) * 1000 : 0;
    res.summary = {
      harvestDay: harvestDay !== null ? harvestDay : N_DAYS - 1,
      harvestDate: harvest.date,
      bbchAtHarvest: harvest.bbch,
      yieldKgPerVine: harvest.berryFWTotal / 1000,
      yieldTPerHa: (harvest.berryFWTotal / 1000) * DENSITY_VINES_HA / 1000,
      brix: harvest.brix, ta: harvest.ta, ph: harvest.pH, yan,
      terpFreeUg: harvest.terpFreeUg, terpBoundUg: harvest.terpBoundUg, terpTotalUg: harvest.terpTotalUg,
      muscatIndex: clamp(harvest.terpFreeUg / 7, 0, 100),
      maxLai: Math.max(...res.daily.map(x => x.lai)),
      gddSeason: harvest.gdd,
      variety: V.name,
    };
    res.balance = {
      cIn, cOut, nIn, nOut,
      cPoolEnd: harvest.leafDM + harvest.shootDM + harvest.rootDM + harvest.berryDM + harvest.clusterDM,
      note: 'Tier 1: аудит потоків; повний тест масового балансу — validation/ (наступний етап E5)',
    };
    return res;
  }

  function dayToDate(d) {
    const date = new Date(2026, 3, 1 + d); // сезон: 1 квітня +
    return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  }

  // ---------- Чутливість (±20%) ----------
  function sensitivity(cfg, keys, targetFn) {
    const baseRun = simulate(cfg);
    const base = targetFn(baseRun);
    const out = [];
    for (const k of keys) {
      const minus = Object.assign({}, cfg); minus[k] = cfg[k] * 0.8;
      const plus = Object.assign({}, cfg); plus[k] = cfg[k] * 1.2;
      out.push({ key: k, minus: targetFn(simulate(minus)) - base, plus: targetFn(simulate(plus)) - base, base });
    }
    return out;
  }

  return { simulate, sensitivity, defaultConfig, VARIETIES, TEMP_SCENARIOS, PHENO };
})();
