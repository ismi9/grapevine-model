/**
 * Мінімальна canvas-бібліотека графіків (без залежностей).
 * Лінійні графики, стовпчики, торнадо, діаграма потоків.
 */
'use strict';
const Charts = (function () {
  const DPR = () => window.devicePixelRatio || 1;

  function prep(canvas) {
    const dpr = DPR();
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10) return null;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function niceTicks(lo, hi, n) {
    if (hi <= lo) hi = lo + 1;
    const step = Math.pow(10, Math.floor(Math.log10(hi - lo)));
    const err = (hi - lo) / step / n;
    let mult = 1;
    for (const m of [1, 2, 2.5, 5, 10]) if (err <= m) { mult = m; break; }
    const s = step * mult;
    const start = Math.ceil(lo / s) * s;
    const out = [];
    for (let v = start; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10));
    return out;
  }

  /**
   * Лінійний графік з кількома серіями (можна з областтю).
   * series: [{ name, color, values: [...], dashed?:bool, area?:bool }]
   * opts: { xTicks?:[{x,label}], yLabel?, xLabel?, smooth?:bool }
   */
  function line(canvas, series, opts = {}) {
    const p = prep(canvas); if (!p) return;
    const { ctx, w, h } = p;
    const padL = 46, padR = 12, padT = 14, padB = 26;
    ctx.clearRect(0, 0, w, h);
    const all = series.flatMap(s => s.values).filter(v => isFinite(v));
    if (!all.length) return;
    let yMin = opts.yMin !== undefined ? opts.yMin : Math.min(...all);
    let yMax = opts.yMax !== undefined ? opts.yMax : Math.max(...all);
    if (yMax === yMin) yMax = yMin + 1;
    const yPad = (yMax - yMin) * 0.06;
    if (opts.yMin === undefined) yMin = Math.max(0, yMin - yPad);
    if (opts.yMax === undefined) yMax = yMax + yPad;
    const n = Math.max(...series.map(s => s.values.length));
    const X = i => padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
    const Y = v => h - padB - ((v - yMin) / (yMax - yMin)) * (h - padT - padB);

    // сітка + підписи Y
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#68776d';
    for (const t of niceTicks(yMin, yMax, 5)) {
      const y = Y(t);
      ctx.strokeStyle = '#e3e0d8';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(t >= 1000 ? (t / 1000).toFixed(0) + 'k' : String(+t.toFixed(2)), 6, y + 3);
    }
    // підписи X (місяці)
    const months = [['Кві', 0], ['Тра', 30], ['Чер', 61], ['Лип', 91], ['Сер', 122], ['Вер', 153], ['Жов', 183]];
    ctx.fillStyle = '#68776d';
    for (const [m, d] of months) {
      if (d < n) ctx.fillText(m, X(d) - 8, h - 8);
    }
    // нуль
    if (yMin < 0) { ctx.strokeStyle = '#b8b2a4'; ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(w - padR, Y(0)); ctx.stroke(); }

    // серії
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.dashed ? 1.4 : 2;
      ctx.setLineDash(s.dashed ? [5, 4] : []);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.values.length; i++) {
        const v = s.values[i];
        if (!isFinite(v)) continue;
        if (!started) { ctx.moveTo(X(i), Y(v)); started = true; }
        else ctx.lineTo(X(i), Y(v));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.area) {
        ctx.lineTo(X(s.values.length - 1), Y(yMin)); ctx.lineTo(X(0), Y(yMin)); ctx.closePath();
        ctx.globalAlpha = 0.12; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    // легенда
    if (series.length > 1 && opts.legend !== false) {
      let lx = padL, ly = 10;
      for (const s of series) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, ly - 3, 8, 3);
        ctx.fillStyle = '#33392f';
        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.fillText(s.name, lx + 12, ly);
        lx += 16 + ctx.measureText(s.name).width + 16;
      }
    }
  }

  // Стоптова діаграма (нормована, для факторів обмеження)
  function bars(canvas, items, opts = {}) {
    const p = prep(canvas); if (!p) return;
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const padL = 110, padR = 24, padT = 6, padB = 6;
    const rowH = (h - padT - padB) / items.length;
    const X = v => padL + (v / 1.2) * (w - padL - padR);
    items.forEach((it, idx) => {
      const y = padT + idx * rowH + rowH * 0.18;
      const bh = rowH * 0.64;
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#33392f';
      ctx.textAlign = 'right';
      ctx.fillText(it.label, padL - 8, y + bh * 0.75);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e9e6dc';
      ctx.fillRect(padL, y, w - padL - padR, bh);
      ctx.fillStyle = it.color || '#2d6a4f';
      ctx.fillRect(padL, y, Math.max(1, X(it.value) - padL), bh);
      ctx.fillStyle = '#f3f1e9';
      ctx.fillText(it.value.toFixed(2), Math.min(X(it.value) + 4, w - 30), y + bh * 0.75);
    });
  }

  // Торнадо-діаграма чутливості
  function tornado(canvas, items, opts = {}) {
    const p = prep(canvas); if (!p) return;
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const padL = 120, padR = 30, padT = 10, padB = 22;
    let maxAbs = 1e-9;
    for (const it of items) maxAbs = Math.max(maxAbs, Math.abs(it.minus), Math.abs(it.plus));
    const X0 = padL + (w - padL - padR) / 2;
    const scale = ((w - padL - padR) / 2) / maxAbs;
    const rowH = (h - padT - padB) / items.length;
    // вісь
    ctx.strokeStyle = '#b8b2a4';
    ctx.beginPath(); ctx.moveTo(X0, padT); ctx.lineTo(X0, h - padB); ctx.stroke();
    ctx.font = '10px "IBM Plex Mono", monospace';
    items.forEach((it, idx) => {
      const y = padT + idx * rowH;
      const bh = rowH * 0.62;
      ctx.fillStyle = '#33392f';
      ctx.textAlign = 'right';
      ctx.fillText(it.label, padL - 8, y + bh * 0.72);
      ctx.textAlign = 'left';
      // мінус (ліворуч)
      ctx.fillStyle = '#c67850';
      const wMin = Math.abs(it.minus) * scale;
      ctx.fillRect(X0 - wMin, y, wMin, bh);
      // плюс (праворуч)
      ctx.fillStyle = '#2d6a4f';
      ctx.fillRect(X0, y, Math.abs(it.plus) * scale, bh);
      // значення
      ctx.fillStyle = '#68776d';
      if (it.minus !== 0) ctx.fillText(it.minus.toFixed(0), X0 - wMin - 30, y + bh * 0.72);
      if (it.plus !== 0) ctx.fillText('+' + it.plus.toFixed(0), X0 + Math.abs(it.plus) * scale + 4, y + bh * 0.72);
    });
    ctx.fillStyle = '#68776d';
    ctx.fillText('−20% вхідного', padL - 96, h - 6);
    ctx.fillText('+20% вхідного', X0 + 6, h - 6);
  }

  // Діаграма потоків C/N (простий Sankey-подібний малюнок)
  function flows(canvas, flows, opts = {}) {
    const p = prep(canvas); if (!p) return;
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const nodes = {};
    let maxFlow = 1e-9;
    for (const f of flows) maxFlow = Math.max(maxFlow, Math.abs(f.value));
    // автоматичне розміщення: left -> right, right1/route2
    const layout = opts.layout || { left: ['Атмосфера (CO₂)', 'Ґрунт (N)'], mid: ['Листя'], right: ['Пагони', 'Коріння', 'Деревина (резерви)', 'Ягоди', 'Дихання', 'Втрати'] };
    const pos = {};
    const colW = w / 3;
    layout.left.forEach((name, i) => pos[name] = { x: colW * 0.12, y: (i + 1) * h / (layout.left.length + 1) });
    layout.mid.forEach((name, i) => pos[name] = { x: colW * 1.0, y: (i + 1) * h / (layout.mid.length + 1) });
    layout.right.forEach((name, i) => pos[name] = { x: colW * 1.88, y: (i + 1) * h / (layout.right.length + 1) });
    for (const f of flows) {
      const a = pos[f.from], b = pos[f.to];
      if (!a || !b) continue;
      const thick = 1 + (Math.abs(f.value) / maxFlow) * 7;
      ctx.strokeStyle = f.color || '#2d6a4f';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = thick;
      ctx.beginPath();
      const mx = (a.x + b.x) / 2;
      ctx.moveTo(a.x + 14, a.y);
      ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x - 14, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = '10.5px "IBM Plex Mono", monospace';
    for (const [name, pnt] of Object.entries(pos)) {
      ctx.fillStyle = '#f3f1e9';
      const tw = ctx.measureText(name).width + 10;
      ctx.strokeStyle = '#b8b2a4';
      roundRect(ctx, pnt.x - 7, pnt.y - 9, tw, 18, 4);
      ctx.stroke();
      ctx.fillStyle = '#33392f';
      ctx.fillText(name, pnt.x + 4 - 7 + 5, pnt.y + 4);
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  return { line, bars, tornado, flows };
})();
