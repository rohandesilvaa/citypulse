// Canvas renderer. The static city is painted once into an offscreen canvas;
// every frame we blit it and draw traffic, units, incidents and effects on top.
import { TILE, rng } from './city.js';

export const SERVICE_COLOR = {
  fire: '#ff6b35', ambulance: '#2ee6a6', police: '#4d8dff', ignore: '#8b97ab',
  pending: '#ffb020', custom: '#c084fc',
};
export const SERVICE_ICON = { fire: '🔥', ambulance: '🚑', police: '🚨', ignore: '🚫' };
const OUTCOME_ICON = {
  saved: '✅', recovered: '✅', handled: '✅', filtered: '🚫', ignored: '🚫',
  late: '⌛', missed: '❌', wasted: '💨',
};
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",system-ui,sans-serif';

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const ROOF_PALETTE = ['#27344a', '#2c3a52', '#303848', '#263d4a', '#35304a', '#3a3530', '#2a3f3c', '#3b3f4c', '#2f2f3f', '#40382f'];
const STATION_COLOR = { hq: '#38d9ff', fire: '#ff6b35', hospital: '#2ee6a6', police: '#4d8dff' };
const STATION_ROOF = { hq: '#1f3b4f', fire: '#8f2418', hospital: '#dfe6ee', police: '#1d3f8f' };

export class Renderer {
  constructor(canvas, city) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.city = city;
    this.particles = [];
    this.floats = [];
    this.glows = new Map();
    this.highlight = null;
    this.hover = null;
    this.resize();
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(box.width * dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * dpr));
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    const { cols, rows } = this.city;
    const pad = 14 * dpr;
    this.T = Math.min((this.canvas.width - pad * 2) / cols, (this.canvas.height - pad * 2) / rows);
    this.ox = (this.canvas.width - cols * this.T) / 2;
    this.oy = (this.canvas.height - rows * this.T) / 2;
    this.glows.clear();
    this.staticCanvas = null;
    if (this.T < 2) return; // layout not ready yet; the ResizeObserver will call again
    this.buildStatic();
  }

  X(tx) { return this.ox + tx * this.T; }
  Y(ty) { return this.oy + ty * this.T; }
  // screen (CSS px) -> tile units
  toTile(cssX, cssY) { return { x: (cssX * this.dpr - this.ox) / this.T, y: (cssY * this.dpr - this.oy) / this.T }; }
  toCss(tx, ty) { return { x: this.X(tx) / this.dpr, y: this.Y(ty) / this.dpr }; }

  rect(g, x, y, w, h) {
    const x0 = Math.round(this.X(x)), y0 = Math.round(this.Y(y));
    g.fillRect(x0, y0, Math.round(this.X(x + w)) - x0, Math.round(this.Y(y + h)) - y0);
  }

  glow(color, radius) {
    const r = Math.max(2, Math.round(radius));
    const key = `${color}|${r}`;
    let c = this.glows.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = r * 2;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, rgba(color, 0.9));
      grad.addColorStop(0.25, rgba(color, 0.35));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      this.glows.set(key, c);
    }
    return c;
  }

  // ------------------------------------------------------------------ static city
  buildStatic() {
    const { city, T } = this;
    const W = this.canvas.width, H = this.canvas.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const r = rng(city.seed + 11);

    g.fillStyle = '#05080e';
    g.fillRect(0, 0, W, H);

    const mx = this.X(0), my = this.Y(0), mw = city.cols * T, mh = city.rows * T;
    g.save();
    g.beginPath();
    g.roundRect(mx, my, mw, mh, 10 * this.dpr);
    g.clip();

    // Base tiles
    for (let y = 0; y < city.rows; y++) {
      for (let x = 0; x < city.cols; x++) {
        const t = city.get(x, y);
        g.fillStyle = t === TILE.WATER ? (x < 2 ? '#081a2c' : '#0a2238')
          : t === TILE.SAND ? '#211f19'
            : t === TILE.ROAD ? '#161d29'
              : t === TILE.PARK ? '#0c2016'
                : '#0e141e';
        this.rect(g, x, y, 1, 1);
      }
    }

    // Sea gradient + waves
    const sea = g.createLinearGradient(mx, 0, this.X(2.2), 0);
    sea.addColorStop(0, 'rgba(4,10,20,0.8)');
    sea.addColorStop(1, 'rgba(40,110,170,0.12)');
    g.fillStyle = sea;
    g.fillRect(mx, my, this.X(2) - mx, mh);
    g.lineCap = 'round';
    for (let y = 0; y < city.rows; y++) {
      for (let x = 0; x < city.cols; x++) {
        if (city.get(x, y) !== TILE.WATER) continue;
        for (let k = 0; k < 2; k++) {
          const wx = this.X(x + r()), wy = this.Y(y + r());
          g.strokeStyle = `rgba(140,200,255,${0.05 + r() * 0.07})`;
          g.lineWidth = Math.max(1, T * 0.05);
          g.beginPath();
          g.arc(wx, wy, T * 0.22, Math.PI * 1.15, Math.PI * 1.85);
          g.stroke();
        }
      }
    }
    // surf line on the beach
    g.strokeStyle = 'rgba(190,230,255,0.18)';
    g.lineWidth = Math.max(1, T * 0.06);
    g.beginPath();
    for (let y = 0; y <= city.rows; y += 0.25) {
      const xx = this.X(2 + 0.08 * Math.sin(y * 2.3));
      if (y === 0) g.moveTo(xx, this.Y(y)); else g.lineTo(xx, this.Y(y));
    }
    g.stroke();

    // Roads: curbs, lane markings, crosswalks, bridges
    const d = this.dpr;
    for (let y = 0; y < city.rows; y++) {
      for (let x = 0; x < city.cols; x++) {
        if (!city.isRoad(x, y)) continue;
        const L = city.isRoad(x - 1, y), R = city.isRoad(x + 1, y), U = city.isRoad(x, y - 1), D = city.isRoad(x, y + 1);
        const x0 = this.X(x), y0 = this.Y(y);
        const isBridge = city.bridge[city.i(x, y)];
        if (isBridge) {
          g.fillStyle = '#1d2531';
          this.rect(g, x, y, 1, 1);
        }
        g.fillStyle = isBridge ? 'rgba(170,190,220,0.45)' : 'rgba(120,140,170,0.13)';
        const cw = Math.max(1, isBridge ? 1.6 * d : 1 * d);
        if (!U && city.inb(x, y - 1)) g.fillRect(x0, y0, T, cw);
        if (!D && city.inb(x, y + 1)) g.fillRect(x0, y0 + T - cw, T, cw);
        if (!L && city.inb(x - 1, y)) g.fillRect(x0, y0, cw, T);
        if (!R && city.inb(x + 1, y)) g.fillRect(x0 + T - cw, y0, cw, T);

        const n = L + R + U + D;
        g.fillStyle = 'rgba(255,205,110,0.22)';
        const dash = T * 0.34, lw = Math.max(1, T * 0.05);
        if ((L || R) && !U && !D) g.fillRect(x0 + (T - dash) / 2, y0 + T / 2 - lw / 2, dash, lw);
        else if ((U || D) && !L && !R) g.fillRect(x0 + T / 2 - lw / 2, y0 + (T - dash) / 2, lw, dash);
        else if (n >= 3) {
          g.fillStyle = 'rgba(255,255,255,0.025)';
          g.fillRect(x0, y0, T, T);
          // zebra crossings on the approaches
          g.fillStyle = 'rgba(230,236,245,0.13)';
          const s = T / 7;
          for (let k = 1; k < 6; k += 2) {
            if (L) g.fillRect(this.X(x - 1) + T - s * 1.4, y0 + k * s, s, s * 0.9);
            if (U) g.fillRect(x0 + k * s, this.Y(y - 1) + T - s * 1.4, s * 0.9, s);
          }
        }
      }
    }

    // Parks with trees
    for (let y = 0; y < city.rows; y++) {
      for (let x = 0; x < city.cols; x++) {
        if (city.get(x, y) !== TILE.PARK) continue;
        if (r.chance(0.3)) {
          g.fillStyle = 'rgba(120,160,120,0.08)';
          g.fillRect(this.X(x + 0.1), this.Y(y + 0.45), T * 0.8, T * 0.1);
        }
        const n = 2 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const tx = this.X(x + 0.15 + r() * 0.7), ty = this.Y(y + 0.15 + r() * 0.7);
          const tr = T * (0.14 + r() * 0.14);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.beginPath(); g.arc(tx + tr * 0.35, ty + tr * 0.35, tr, 0, 7); g.fill();
          g.fillStyle = r.chance(0.5) ? '#17432a' : '#1c4f31';
          g.beginPath(); g.arc(tx, ty, tr, 0, 7); g.fill();
          g.fillStyle = 'rgba(140,220,150,0.12)';
          g.beginPath(); g.arc(tx - tr * 0.3, ty - tr * 0.3, tr * 0.5, 0, 7); g.fill();
        }
      }
    }

    // Street lamps: warm glows along roads
    g.globalCompositeOperation = 'lighter';
    for (const p of city.roadTiles) {
      const n = city.roadNeighbors(p.x, p.y).length;
      if (n >= 3 || (p.x + p.y * 3) % 4 === 0) {
        const rad = T * (n >= 3 ? 1.5 : 0.9);
        const img = this.glow('#ffb46a', rad);
        g.globalAlpha = n >= 3 ? 0.16 : 0.08;
        g.drawImage(img, this.X(p.x + 0.5) - rad, this.Y(p.y + 0.5) - rad);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Buildings (sorted top->bottom so front buildings overlap back ones)
    const lots = city.lots.slice().sort((a, b) => (a.y + a.h) - (b.y + b.h) || a.x - b.x);
    for (const lot of lots) this.drawLot(g, lot);

    // Street names
    if (T >= 13 * d) this.drawStreetNames(g);

    g.restore();

    // Vignette + frame
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,160,220,0.18)';
    g.lineWidth = 1 * d;
    g.beginPath();
    g.roundRect(mx + 0.5, my + 0.5, mw - 1, mh - 1, 10 * d);
    g.stroke();

    this.staticCanvas = c;
  }

  drawLot(g, lot) {
    const { T } = this;
    const r = rng(Math.floor(lot.seed * 1e9));
    const special = lot.kind !== 'building';
    const pad = T * (special ? 0.08 : 0.13);
    const px = this.X(lot.x) + pad, py = this.Y(lot.y) + pad;
    const pw = lot.w * T - pad * 2, ph = lot.h * T - pad * 2;
    const e = lot.height * T * 0.055;
    const ex = e * 0.35, ey = e;
    const roof = special ? STATION_ROOF[lot.kind] : ROOF_PALETTE[Math.floor(lot.hue * ROOF_PALETTE.length)];
    const rx = px - ex, ry = py - ey;

    // ground shadow
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(px + e * 0.25, py + e * 0.25, pw, ph);

    // walls (hull between footprint and roof)
    g.fillStyle = shade(roof.startsWith('#') ? roof : '#303848', special && lot.kind === 'hospital' ? 0.55 : 0.5);
    g.beginPath();
    g.moveTo(rx, ry); g.lineTo(rx + pw, ry); g.lineTo(px + pw, py);
    g.lineTo(px + pw, py + ph); g.lineTo(px, py + ph); g.lineTo(rx, ry + ph);
    g.closePath();
    g.fill();

    // lit windows on the south face
    if (ey > 3 * this.dpr) {
      const rowsN = Math.max(1, Math.floor(ey / (3.2 * this.dpr)));
      const colsN = Math.max(2, Math.floor(pw / (3.4 * this.dpr)));
      const ws = Math.max(1, 1.2 * this.dpr);
      for (let i = 0; i < rowsN; i++) {
        for (let j = 0; j < colsN; j++) {
          if (!r.chance(0.42)) continue;
          const f = (i + 0.5) / rowsN;
          const wx = rx + (j + 0.5) / colsN * pw + ex * f;
          const wy = ry + ph + ey * f;
          g.fillStyle = r.chance(0.85) ? `rgba(255,${200 + r.int(0, 40)},120,${0.45 + r() * 0.4})` : 'rgba(150,200,255,0.6)';
          g.fillRect(wx - ws / 2, wy - ws / 2, ws, ws);
        }
      }
    }

    // roof
    const rg = g.createLinearGradient(rx, ry, rx + pw, ry + ph);
    rg.addColorStop(0, shade(roof, 1.18));
    rg.addColorStop(1, shade(roof, 0.92));
    g.fillStyle = rg;
    g.fillRect(rx, ry, pw, ph);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(rx, ry, pw, Math.max(1, this.dpr));
    g.fillRect(rx, ry, Math.max(1, this.dpr), ph);

    if (!special) {
      // rooftop details
      const n = r.int(0, 3);
      for (let k = 0; k < n; k++) {
        const s = T * (0.1 + r() * 0.12);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(rx + r() * (pw - s), ry + r() * (ph - s), s, s);
      }
      if (lot.height >= 5 && lot.w * lot.h >= 4) {
        g.strokeStyle = 'rgba(255,220,120,0.35)';
        g.lineWidth = Math.max(1, this.dpr);
        g.beginPath(); g.arc(rx + pw / 2, ry + ph / 2, Math.min(pw, ph) * 0.26, 0, 7); g.stroke();
        g.fillStyle = 'rgba(255,220,120,0.45)';
        g.font = `700 ${Math.min(pw, ph) * 0.26}px ${UI_FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('H', rx + pw / 2, ry + ph / 2 + 0.5);
        // aircraft warning light
        g.globalCompositeOperation = 'lighter';
        const gl = this.glow('#ff4040', T * 0.35);
        g.drawImage(gl, rx + pw - T * 0.45, ry - T * 0.25);
        g.globalCompositeOperation = 'source-over';
      }
      return;
    }

    // stations
    const cx = rx + pw / 2, cy = ry + ph / 2;
    if (lot.kind === 'hospital') {
      const s = Math.min(pw, ph) * 0.5, b = s / 3;
      g.fillStyle = '#e5484d';
      g.fillRect(cx - s / 2, cy - b / 2, s, b);
      g.fillRect(cx - b / 2, cy - s / 2, b, s);
    } else {
      g.strokeStyle = lot.kind === 'hq' ? 'rgba(90,220,255,0.55)' : 'rgba(255,255,255,0.25)';
      g.lineWidth = Math.max(1, this.dpr * 1.2);
      g.strokeRect(rx + 2 * this.dpr, ry + 2 * this.dpr, pw - 4 * this.dpr, ph - 4 * this.dpr);
      g.font = `${Math.min(pw, ph) * 0.5}px ${EMOJI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(lot.kind === 'hq' ? '📡' : lot.kind === 'fire' ? '🚒' : '🚓', cx, cy + 1);
    }
    if (lot.kind === 'hq') {
      g.globalCompositeOperation = 'lighter';
      const gl = this.glow('#38d9ff', T * 2.2);
      g.globalAlpha = 0.35;
      g.drawImage(gl, cx - T * 2.2, cy - T * 2.2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  drawStationLabels(g) {
    const { T, city, dpr } = this;
    const fs = Math.max(9 * dpr, T * 0.42);
    const th = fs * 1.65;
    const minX = this.X(0) + 4 * dpr, maxX = this.X(city.cols) - 4 * dpr;
    const minY = this.Y(0) + 4 * dpr, maxY = this.Y(city.rows) - 4 * dpr;
    g.font = `750 ${fs}px ${UI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const lot of [city.hq, ...city.stations]) {
      if (!lot) continue;
      const color = STATION_COLOR[lot.kind];
      const tw = g.measureText(lot.label).width + fs * 1.2;
      // just below the building; flip above it when that would leave the map
      let y = this.Y(lot.y + lot.h) + th / 2 + 1.5 * dpr;
      if (y + th / 2 > maxY) y = this.Y(lot.y) - lot.height * T * 0.055 - th / 2 - 2 * dpr;
      y = Math.max(minY + th / 2, Math.min(maxY - th / 2, y));
      const x = Math.max(minX + tw / 2, Math.min(maxX - tw / 2, this.X(lot.cx)));
      g.shadowColor = 'rgba(0,0,0,0.7)';
      g.shadowBlur = 6 * dpr;
      g.fillStyle = 'rgba(5,9,16,0.92)';
      g.beginPath(); g.roundRect(x - tw / 2, y - th / 2, tw, th, th * 0.3); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = rgba(color, 0.75);
      g.lineWidth = dpr;
      g.stroke();
      g.fillStyle = color;
      g.fillText(lot.label, x, y + 0.5 * dpr);
    }
    g.shadowColor = 'transparent';
  }

  drawStreetNames(g) {
    const { city, T } = this;
    const fs = Math.max(7 * this.dpr, T * 0.4);
    g.font = `600 ${fs}px ${UI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(190,205,230,0.30)';
    city.hRoads.forEach((y, i) => {
      // find a straight stretch of this road to label
      const x0 = city.vRoads[1 + (i % Math.max(1, city.vRoads.length - 2))] + 1;
      let len = 0;
      while (city.isRoad(x0 + len, y) && !city.isRoad(x0 + len, y - 1) && !city.isRoad(x0 + len, y + 1)) len++;
      if (len >= 4) g.fillText(city.streetName(x0 + 1, y).toUpperCase(), this.X(x0 + len / 2), this.Y(y + 0.5));
    });
    city.vRoads.forEach((x, i) => {
      const y0 = city.hRoads[(i * 2) % Math.max(1, city.hRoads.length - 1)] + 1;
      let len = 0;
      while (city.isRoad(x, y0 + len) && !city.isRoad(x - 1, y0 + len) && !city.isRoad(x + 1, y0 + len)) len++;
      if (len < 3) return;
      g.save();
      g.translate(this.X(x + 0.5), this.Y(y0 + len / 2));
      g.rotate(-Math.PI / 2);
      g.fillText(city.streetName(x, y0 + 1).toUpperCase(), 0, 0);
      g.restore();
    });
  }

  // ------------------------------------------------------------------ effects
  addFloat(call, text, points, color) {
    this.floats.push({
      x: call.lot.cx, y: call.lot.cy - 0.6, text,
      sub: points ? (points > 0 ? `+${points}` : `${points}`) : '',
      color, life: 0, max: 2.8,
    });
  }

  flash(call) { this.highlight = { id: call.id, until: performance.now() + 2200 }; }

  updateParticles(game, dt) {
    const { r } = game;
    for (const c of game.calls) {
      const burning = c.truth === 'fire' && !['onscene', 'resolved'].includes(c.status) && c.truthUrgency !== 'low';
      const smoking = c.truth === 'fire' && (burning || (c.status === 'onscene'));
      if (burning && r.chance(dt * 26)) {
        this.particles.push({ kind: 'flame', x: c.lot.cx + (r() - 0.5) * c.lot.w * 0.6, y: c.lot.cy + (r() - 0.5) * c.lot.h * 0.5,
          vx: (r() - 0.5) * 0.3, vy: -0.6 - r() * 0.7, life: 0, max: 0.6 + r() * 0.5, s: 0.18 + r() * 0.2 });
      }
      if (smoking && r.chance(dt * 9)) {
        this.particles.push({ kind: 'smoke', x: c.lot.cx + (r() - 0.5) * 0.6, y: c.lot.cy - 0.2,
          vx: 0.25 + r() * 0.25, vy: -0.35 - r() * 0.3, life: 0, max: 2.2 + r() * 1.5, s: 0.25 + r() * 0.2 });
      }
      if (c.status === 'onscene' && c.unit?.type === 'fire' && c.truth === 'fire' && r.chance(dt * 30)) {
        const v = c.unit;
        const ang = Math.atan2(c.lot.cy - v.pos.y, c.lot.cx - v.pos.x) + (r() - 0.5) * 0.4;
        this.particles.push({ kind: 'water', x: v.pos.x, y: v.pos.y, vx: Math.cos(ang) * 2.4, vy: Math.sin(ang) * 2.4,
          life: 0, max: 0.45, s: 0.06 + r() * 0.05 });
      }
    }
    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'smoke') p.s += dt * 0.25;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
    for (const f of this.floats) f.life += dt;
    this.floats = this.floats.filter((f) => f.life < f.max);
  }

  // ------------------------------------------------------------------ frame
  draw(game, now, dt) {
    const g = this.ctx;
    const { T } = this;
    const time = now / 1000;
    if (!this.staticCanvas) return;
    if (!game.paused) this.updateParticles(game, dt * game.speed);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.staticCanvas, 0, 0);

    // clip dynamic layer to the map
    g.save();
    g.beginPath();
    g.roundRect(this.X(0), this.Y(0), this.city.cols * T, this.city.rows * T, 10 * this.dpr);
    g.clip();

    // civilian traffic
    for (const car of game.cars) this.drawCar(g, car);

    // routes
    for (const v of game.vehicles) {
      if (v.state !== 'enroute' || !v.path) continue;
      const col = SERVICE_COLOR[v.type];
      g.save();
      g.strokeStyle = rgba(col, 0.75);
      g.lineWidth = Math.max(1.5, T * 0.09);
      g.setLineDash([T * 0.28, T * 0.22]);
      g.lineDashOffset = -time * T * 1.6;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(this.X(v.pos.x), this.Y(v.pos.y));
      for (let k = v.pi; k < v.path.length; k++) g.lineTo(this.X(v.path[k].x), this.Y(v.path[k].y));
      g.stroke();
      g.restore();
    }

    // HQ → analyzing call link
    const hq = this.city.hq;
    if (hq && game.current) {
      const c = game.current;
      const x1 = this.X(hq.cx), y1 = this.Y(hq.cy), x2 = this.X(c.lot.cx), y2 = this.Y(c.lot.cy);
      const grad = g.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, 'rgba(56,217,255,0.7)');
      grad.addColorStop(1, 'rgba(255,176,32,0.7)');
      g.save();
      g.strokeStyle = grad;
      g.lineWidth = Math.max(1, T * 0.06);
      g.setLineDash([T * 0.12, T * 0.18]);
      g.lineDashOffset = time * T * 2.5;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.restore();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const f = (time * 0.9 + k / 3) % 1;
        const img = this.glow('#38d9ff', T * 0.5);
        g.drawImage(img, x1 + (x2 - x1) * f - T * 0.5, y1 + (y2 - y1) * f - T * 0.5);
      }
      g.globalCompositeOperation = 'source-over';
    }

    // incidents
    for (const c of game.calls) this.drawIncident(g, c, game, time);

    // particles
    this.drawParticles(g);

    // emergency units
    for (const v of game.vehicles) this.drawVehicle(g, v, time);

    // station names stay on top of traffic, units and buildings
    this.drawStationLabels(g);

    // floating labels
    for (const f of this.floats) {
      const k = f.life / f.max;
      const a = k < 0.1 ? k / 0.1 : 1 - Math.max(0, (k - 0.6) / 0.4);
      const x = this.X(f.x), y = this.Y(f.y - k * 1.4);
      const fs = Math.max(10 * this.dpr, T * 0.55);
      g.font = `800 ${fs}px ${UI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.globalAlpha = a;
      g.lineWidth = 4 * this.dpr;
      g.strokeStyle = 'rgba(3,6,12,0.9)';
      g.strokeText(f.text, x, y);
      g.fillStyle = f.color;
      g.fillText(f.text, x, y);
      if (f.sub) {
        g.font = `800 ${fs * 0.9}px ${UI_FONT}`;
        g.strokeText(f.sub, x, y + fs * 1.05);
        g.fillStyle = f.sub.startsWith('+') ? '#2ee6a6' : '#ff5c7a';
        g.fillText(f.sub, x, y + fs * 1.05);
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  drawCar(g, car) {
    const { T } = this;
    const lane = 0.19;
    const x = this.X(car.pos.x + Math.sin(car.angle) * lane);
    const y = this.Y(car.pos.y - Math.cos(car.angle) * lane);
    const L = car.len * T, Wd = 0.24 * T;
    g.save();
    g.translate(x, y);
    g.rotate(car.angle);
    g.fillStyle = car.color;
    g.beginPath(); g.roundRect(-L / 2, -Wd / 2, L, Wd, Wd * 0.3); g.fill();
    g.fillStyle = 'rgba(10,15,25,0.55)';
    g.fillRect(L * 0.05, -Wd * 0.35, L * 0.22, Wd * 0.7);
    g.fillStyle = '#ffe9b0';
    g.fillRect(L / 2 - 1.2 * this.dpr, -Wd / 2 + 0.5, 1.2 * this.dpr, Wd * 0.25);
    g.fillRect(L / 2 - 1.2 * this.dpr, Wd / 2 - Wd * 0.25 - 0.5, 1.2 * this.dpr, Wd * 0.25);
    g.fillStyle = '#ff3b3b';
    g.fillRect(-L / 2, -Wd / 2 + 0.5, 1 * this.dpr, Wd * 0.22);
    g.fillRect(-L / 2, Wd / 2 - Wd * 0.22 - 0.5, 1 * this.dpr, Wd * 0.22);
    // headlight beam
    g.globalCompositeOperation = 'lighter';
    const beam = g.createLinearGradient(L / 2, 0, L / 2 + T * 0.7, 0);
    beam.addColorStop(0, 'rgba(255,230,170,0.16)');
    beam.addColorStop(1, 'rgba(255,230,170,0)');
    g.fillStyle = beam;
    g.beginPath(); g.moveTo(L / 2, -Wd * 0.4); g.lineTo(L / 2 + T * 0.7, -Wd * 0.9); g.lineTo(L / 2 + T * 0.7, Wd * 0.9); g.lineTo(L / 2, Wd * 0.4); g.fill();
    g.restore();
  }

  drawVehicle(g, v, time) {
    const { T } = this;
    const moving = v.state === 'enroute' || v.state === 'returning';
    const lane = moving ? 0.2 : 0;
    const x = this.X(v.pos.x + Math.sin(v.angle) * lane);
    const y = this.Y(v.pos.y - Math.cos(v.angle) * lane);
    const L = (v.type === 'fire' ? 0.78 : 0.66) * T, Wd = 0.36 * T;
    const col = SERVICE_COLOR[v.type];

    // ground glow
    if (v.state !== 'idle') {
      g.globalCompositeOperation = 'lighter';
      const img = this.glow(col, T * 0.9);
      g.globalAlpha = 0.35;
      g.drawImage(img, x - T * 0.9, y - T * 0.9);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    g.save();
    g.translate(x, y);
    g.rotate(v.angle);
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath(); g.roundRect(-L / 2 + 1.5 * this.dpr, -Wd / 2 + 1.5 * this.dpr, L, Wd, Wd * 0.25); g.fill();
    // body
    const body = v.type === 'fire' ? '#d83a22' : v.type === 'ambulance' ? '#f2f5f8' : '#162a55';
    g.fillStyle = body;
    g.beginPath(); g.roundRect(-L / 2, -Wd / 2, L, Wd, Wd * 0.25); g.fill();
    // details
    if (v.type === 'fire') {
      g.strokeStyle = 'rgba(230,230,230,0.8)';
      g.lineWidth = Math.max(1, this.dpr * 0.8);
      g.beginPath();
      g.moveTo(-L * 0.38, -Wd * 0.16); g.lineTo(L * 0.12, -Wd * 0.16);
      g.moveTo(-L * 0.38, Wd * 0.16); g.lineTo(L * 0.12, Wd * 0.16);
      for (let k = -0.35; k <= 0.1; k += 0.09) { g.moveTo(L * k, -Wd * 0.16); g.lineTo(L * k, Wd * 0.16); }
      g.stroke();
    } else if (v.type === 'ambulance') {
      g.fillStyle = '#e5484d';
      g.fillRect(-L / 2, -Wd * 0.08, L * 0.95, Wd * 0.16);
      const s = Wd * 0.5, b = s / 3;
      g.fillRect(-L * 0.2 - s / 2, -b / 2, s, b);
      g.fillRect(-L * 0.2 - b / 2, -s / 2, b, s);
    } else {
      g.fillStyle = '#f2f5f8';
      g.fillRect(-L * 0.25, -Wd / 2, L * 0.35, Wd);
    }
    // windshield
    g.fillStyle = 'rgba(15,25,40,0.85)';
    g.fillRect(L * 0.2, -Wd * 0.38, L * 0.14, Wd * 0.76);
    // light bar
    const on = v.siren && v.state !== 'idle';
    const phase = Math.floor(time * 7) % 2;
    const c1 = v.type === 'ambulance' ? '#ff2d2d' : v.type === 'police' ? '#3b82ff' : '#ff2d2d';
    const c2 = v.type === 'police' ? '#ff2d2d' : v.type === 'ambulance' ? '#3b82ff' : '#ffb020';
    g.fillStyle = on ? (phase ? c1 : shade(c1, 0.4)) : shade(c1, 0.45);
    g.fillRect(L * 0.05, -Wd * 0.42, L * 0.1, Wd * 0.38);
    g.fillStyle = on ? (phase ? shade(c2, 0.4) : c2) : shade(c2, 0.45);
    g.fillRect(L * 0.05, Wd * 0.04, L * 0.1, Wd * 0.38);
    // headlights
    if (moving) {
      g.globalCompositeOperation = 'lighter';
      const beam = g.createLinearGradient(L / 2, 0, L / 2 + T * 1.1, 0);
      beam.addColorStop(0, 'rgba(255,240,200,0.28)');
      beam.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = beam;
      g.beginPath(); g.moveTo(L / 2, -Wd * 0.4); g.lineTo(L / 2 + T * 1.1, -Wd * 1.1); g.lineTo(L / 2 + T * 1.1, Wd * 1.1); g.lineTo(L / 2, Wd * 0.4); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();

    // flashing glow
    if (on || v.state === 'onscene') {
      g.globalCompositeOperation = 'lighter';
      const flashCol = phase ? c1 : c2;
      const img = this.glow(flashCol, T * 1.1);
      g.globalAlpha = 0.55;
      g.drawImage(img, x - T * 1.1, y - T * 1.1);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  drawIncident(g, c, game, time) {
    const { T } = this;
    const x = this.X(c.lot.cx), y = this.Y(c.lot.cy);
    const decided = c.decision;
    const color = c.status === 'resolved'
      ? ({ saved: '#2ee6a6', recovered: '#2ee6a6', handled: '#c084fc', late: '#ff8a3d', missed: '#ff3b5c', wasted: '#8b97ab' }[c.outcome] || '#8b97ab')
      : c.custom && !decided ? SERVICE_COLOR.custom
        : decided ? SERVICE_COLOR[decided.service] : SERVICE_COLOR.pending;
    const fade = c.status === 'resolved' ? Math.max(0, Math.min(1, (c.closeT - game.t) / 1.5)) : 1;
    g.globalAlpha = fade;

    // pulse rings
    if (c.status !== 'resolved') {
      const speed = c.status === 'ringing' ? 2.2 : c.status === 'analyzing' ? 1.6 : 0.9;
      for (let k = 0; k < 2; k++) {
        const ph = (time * speed + k * 0.5) % 1;
        g.strokeStyle = rgba(color, (1 - ph) * 0.8);
        g.lineWidth = Math.max(1, T * 0.07);
        g.beginPath(); g.arc(x, y, T * (0.55 + ph * 1.5), 0, 7); g.stroke();
      }
    }
    // highlight (clicked in list / hover)
    const hl = (this.highlight && this.highlight.id === c.id && performance.now() < this.highlight.until) || this.hover === c.id;
    if (hl) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(1.5, T * 0.08);
      g.setLineDash([T * 0.2, T * 0.14]);
      g.lineDashOffset = -time * T;
      g.beginPath(); g.arc(x, y, T * 1.25, 0, 7); g.stroke();
      g.setLineDash([]);
    }

    // core disc
    g.fillStyle = 'rgba(6,10,18,0.82)';
    g.beginPath(); g.arc(x, y, T * 0.58, 0, 7); g.fill();
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, T * 0.08);
    g.stroke();

    // deadline ring (true time pressure of the emergency)
    const frac = game.deadlineFraction(c);
    if (frac !== null && ['dispatched', 'waiting_unit', 'queued', 'analyzing', 'ringing'].includes(c.status) && c.decision?.service !== 'ignore') {
      g.strokeStyle = frac > 0.5 ? '#2ee6a6' : frac > 0.25 ? '#ffb020' : '#ff3b5c';
      g.lineWidth = Math.max(1.5, T * 0.1);
      g.beginPath(); g.arc(x, y, T * 0.76, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
    }
    // on-scene progress
    if (c.status === 'onscene' && c.sceneEnd) {
      const p = Math.min(1, (game.t - c.sceneStart) / (c.sceneEnd - c.sceneStart));
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(1.5, T * 0.1);
      g.beginPath(); g.arc(x, y, T * 0.76, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); g.stroke();
    }

    // icon
    let icon = '📞';
    if (c.status === 'analyzing') icon = '🧠';
    else if (c.status === 'resolved') icon = OUTCOME_ICON[c.outcome] || '✔️';
    else if (decided) icon = SERVICE_ICON[decided.service];
    const bob = c.status === 'ringing' ? Math.sin(time * 30) * T * 0.05 : 0;
    g.font = `${T * 0.62}px ${EMOJI_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(icon, x + bob, y + T * 0.03);

    // title tag
    if (decided && c.status !== 'resolved' && T >= 12 * this.dpr) {
      const fs = Math.max(8 * this.dpr, T * 0.4);
      g.font = `700 ${fs}px ${UI_FONT}`;
      const text = decided.incident;
      const tw = g.measureText(text).width + fs;
      const ty = y - T * 1.25;
      g.fillStyle = 'rgba(6,10,18,0.9)';
      g.beginPath(); g.roundRect(x - tw / 2, ty - fs * 0.8, tw, fs * 1.6, fs * 0.5); g.fill();
      g.strokeStyle = rgba(color, 0.8);
      g.lineWidth = this.dpr;
      g.stroke();
      g.fillStyle = '#e8eef7';
      g.fillText(text, x, ty + 0.5);
    }
    g.globalAlpha = 1;
  }

  drawParticles(g) {
    const { T } = this;
    for (const p of this.particles) {
      const k = p.life / p.max;
      const x = this.X(p.x), y = this.Y(p.y);
      if (p.kind === 'smoke') {
        g.fillStyle = `rgba(70,76,88,${0.35 * (1 - k)})`;
        g.beginPath(); g.arc(x, y, p.s * T, 0, 7); g.fill();
      }
    }
    g.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const k = p.life / p.max;
      const x = this.X(p.x), y = this.Y(p.y);
      if (p.kind === 'flame') {
        const col = k < 0.3 ? '#ffd166' : k < 0.6 ? '#ff7b2e' : '#d8341a';
        const img = this.glow(col, p.s * T * (1.4 - k * 0.8));
        g.globalAlpha = 1 - k;
        g.drawImage(img, x - img.width / 2, y - img.height / 2);
      } else if (p.kind === 'water') {
        g.globalAlpha = 0.8 * (1 - k);
        g.fillStyle = '#8fd3ff';
        g.beginPath(); g.arc(x, y, p.s * T, 0, 7); g.fill();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  hitTest(game, cssX, cssY) {
    const p = this.toTile(cssX, cssY);
    let best = null, bd = 1.0;
    for (const c of game.calls) {
      const d = Math.hypot(c.lot.cx - p.x, c.lot.cy - p.y);
      if (d < bd) { bd = d; best = { kind: 'call', obj: c }; }
    }
    for (const v of game.vehicles) {
      const d = Math.hypot(v.pos.x - p.x, v.pos.y - p.y);
      if (d < Math.min(bd, 0.6)) { bd = d; best = { kind: 'unit', obj: v }; }
    }
    return best;
  }
}
