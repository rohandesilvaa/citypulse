// Procedural city: a tile grid with a coastline, a river, a road network,
// city blocks split into building lots, parks and emergency stations.

export const TILE = { GROUND: 0, ROAD: 1, WATER: 2, SAND: 3, PARK: 4, LOT: 5 };

export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  f.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(f() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return f;
}

const V_NAMES = ['Ocean Drive', 'Oxford Street', 'Victoria Road', 'Queen Street', 'Elm Street',
  'Lake Drive', 'Station Road', 'King Street', 'Hill Street', 'Canal Road', 'Fort Road', 'Park Avenue'];
const H_NAMES = ['Flower Road', 'Market Street', 'Church Street', 'School Lane', 'Main Street',
  'Bank Street', 'Library Road', 'Clock Tower Road', 'Mill Lane', 'Rose Lane', 'Harbour Road'];

export const STATION_INFO = {
  hq: { label: 'DISPATCH HQ', size: [2, 2] },
  fire: { label: 'FIRE STATION', size: [2, 2] },
  hospital: { label: 'HOSPITAL', size: [3, 2] },
  police: { label: 'POLICE', size: [2, 2] },
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class City {
  constructor(cols, rows, seed = 2026) {
    this.cols = cols;
    this.rows = rows;
    this.seed = seed;
    this.r = rng(seed);
    const n = cols * rows;
    this.tiles = new Uint8Array(n);
    this.bridge = new Uint8Array(n);
    this.lotOf = new Int16Array(n).fill(-1);
    this.lots = [];
    this.stations = [];
    this.hq = null;
    this.vRoads = [];
    this.hRoads = [];
    this.roadTiles = [];
    this.generate();
  }

  i(x, y) { return y * this.cols + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
  get(x, y) { return this.inb(x, y) ? this.tiles[this.i(x, y)] : -1; }
  isRoad(x, y) { return this.get(x, y) === TILE.ROAD; }

  roadNeighbors(x, y) {
    const out = [];
    for (const [dx, dy] of DIRS) if (this.isRoad(x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
    return out;
  }

  generate() {
    const { cols, rows, r } = this;
    const t = this.tiles;

    // Coastline on the west: sea + beach, Ocean Drive runs along it.
    for (let y = 0; y < rows; y++) {
      t[this.i(0, y)] = TILE.WATER;
      t[this.i(1, y)] = TILE.WATER;
      t[this.i(2, y)] = TILE.SAND;
    }
    for (let x = 3; x < cols; x += 6) this.vRoads.push(x);
    for (let y = 2; y < rows - 1; y += 5) this.hRoads.push(y);
    for (const x of this.vRoads) for (let y = 0; y < rows; y++) t[this.i(x, y)] = TILE.ROAD;
    for (const y of this.hRoads) for (let x = 3; x < cols; x++) t[this.i(x, y)] = TILE.ROAD;

    // A meandering river between two avenues, crossed by bridges.
    const k = this.vRoads.findIndex((x) => x > cols * 0.56);
    if (k > 0 && this.vRoads[k] - this.vRoads[k - 1] >= 6) {
      const base = this.vRoads[k - 1] + 2;
      let off = 0;
      for (let y = 0; y < rows; y++) {
        if (y % 3 === 0 && r.chance(0.55)) off = off ? 0 : 1;
        for (let dx = 0; dx < 2; dx++) {
          const id = this.i(base + off + dx, y);
          if (t[id] === TILE.ROAD) this.bridge[id] = 1;
          else t[id] = TILE.WATER;
        }
      }
    }

    this.removeRandomSegments();
    for (let id = 0; id < t.length; id++) {
      if (t[id] === TILE.ROAD) this.roadTiles.push({ x: id % cols, y: Math.floor(id / cols) });
    }

    const regions = this.findRegions();
    this.placeStations(regions);
    this.placeParks(regions);
    this.fillLots();
  }

  removeRandomSegments() {
    const { r } = this;
    const segs = [];
    for (const x of this.vRoads) {
      if (x === 3) continue; // keep the coastal road intact
      for (let j = 0; j < this.hRoads.length - 1; j++) {
        segs.push({ v: true, c: x, a: this.hRoads[j] + 1, b: this.hRoads[j + 1] - 1 });
      }
    }
    for (const y of this.hRoads) {
      for (let j = 0; j < this.vRoads.length - 1; j++) {
        segs.push({ v: false, c: y, a: this.vRoads[j] + 1, b: this.vRoads[j + 1] - 1 });
      }
    }
    r.shuffle(segs);
    let toRemove = Math.floor(segs.length * 0.13);
    for (const s of segs) {
      if (toRemove <= 0) break;
      const ids = [];
      for (let p = s.a; p <= s.b; p++) ids.push(s.v ? this.i(s.c, p) : this.i(p, s.c));
      if (ids.some((id) => this.bridge[id])) continue;
      for (const id of ids) this.tiles[id] = TILE.GROUND;
      if (this.roadsConnected()) toRemove--;
      else for (const id of ids) this.tiles[id] = TILE.ROAD;
    }
  }

  roadsConnected() {
    const t = this.tiles;
    let start = -1, total = 0;
    for (let id = 0; id < t.length; id++) if (t[id] === TILE.ROAD) { total++; if (start < 0) start = id; }
    const seen = new Uint8Array(t.length);
    const q = [start];
    seen[start] = 1;
    let count = 0;
    while (q.length) {
      const id = q.pop();
      count++;
      const x = id % this.cols, y = (id / this.cols) | 0;
      for (const [dx, dy] of DIRS) {
        if (!this.isRoad(x + dx, y + dy)) continue;
        const nid = this.i(x + dx, y + dy);
        if (!seen[nid]) { seen[nid] = 1; q.push(nid); }
      }
    }
    return count === total;
  }

  findRegions() {
    const seen = new Uint8Array(this.tiles.length);
    const regions = [];
    for (let id = 0; id < this.tiles.length; id++) {
      if (seen[id] || this.tiles[id] !== TILE.GROUND) continue;
      const tiles = [];
      const q = [id];
      seen[id] = 1;
      let touchesWater = false;
      while (q.length) {
        const cur = q.pop();
        const x = cur % this.cols, y = (cur / this.cols) | 0;
        tiles.push({ x, y });
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          const tt = this.get(nx, ny);
          if (tt === TILE.WATER && nx > 2) touchesWater = true;
          if (tt !== TILE.GROUND) continue;
          const nid = this.i(nx, ny);
          if (!seen[nid]) { seen[nid] = 1; q.push(nid); }
        }
      }
      const cx = tiles.reduce((s, p) => s + p.x, 0) / tiles.length + 0.5;
      const cy = tiles.reduce((s, p) => s + p.y, 0) / tiles.length + 0.5;
      regions.push({ tiles, cx, cy, touchesWater, set: new Set(tiles.map((p) => this.i(p.x, p.y))) });
    }
    return regions;
  }

  placeStations(regions) {
    const { r, cols, rows } = this;
    // keep stations away from the map edges (the HUD overlays sit in the corners)
    const inner = regions.filter((g) => g.tiles.length >= 8 && g.cy > 5 && g.cy < rows - 5 && g.cx > 6 && g.cx < cols - 5);
    const usable = inner.length >= 7 ? inner : regions.filter((g) => g.tiles.length >= 8);
    const order = ['hq', 'fire', 'hospital', 'police', 'fire', 'hospital', 'police'];
    const chosen = [];
    const used = new Set();
    for (const kind of order) {
      let best = null, bestScore = -Infinity;
      for (const g of usable) {
        if (used.has(g)) continue;
        let score;
        if (kind === 'hq') {
          score = -Math.hypot(g.cx - cols * 0.5, g.cy - rows * 0.5);
        } else {
          const dAll = Math.min(...chosen.map((c) => Math.hypot(c.cx - g.cx, c.cy - g.cy)));
          const same = chosen.filter((c) => c.kind === kind);
          const dSame = same.length ? Math.min(...same.map((c) => Math.hypot(c.cx - g.cx, c.cy - g.cy))) : cols;
          score = dAll + 0.9 * dSame + r() * 3;
        }
        if (score > bestScore && this.fitInRegion(g, STATION_INFO[kind].size)) { bestScore = score; best = g; }
      }
      if (!best) continue;
      used.add(best);
      const pos = this.fitInRegion(best, STATION_INFO[kind].size);
      const lot = this.addLot(pos.x, pos.y, pos.w, pos.h, kind);
      lot.label = STATION_INFO[kind].label;
      chosen.push({ kind, cx: lot.cx, cy: lot.cy });
      if (kind === 'hq') this.hq = lot;
      else this.stations.push(lot);
    }
    const counters = {};
    for (const s of this.stations) {
      counters[s.kind] = (counters[s.kind] || 0) + 1;
      s.index = counters[s.kind];
    }
    this.stations.forEach((s) => { if (counters[s.kind] > 1) s.label += ' ' + s.index; });
  }

  fitInRegion(g, [w0, h0]) {
    const sizes = [[w0, h0], [h0, w0], [2, 2]];
    for (const [w, h] of sizes) {
      const cands = [];
      for (const p of g.tiles) {
        let ok = true;
        for (let dy = 0; dy < h && ok; dy++) {
          for (let dx = 0; dx < w && ok; dx++) {
            const id = this.i(p.x + dx, p.y + dy);
            if (!this.inb(p.x + dx, p.y + dy) || !g.set.has(id) || this.lotOf[id] >= 0) ok = false;
          }
        }
        if (ok && this.lotAccess(p.x, p.y, w, h).length) cands.push({ x: p.x, y: p.y, w, h });
      }
      if (cands.length) return cands[Math.floor(cands.length / 2)];
    }
    return null;
  }

  placeParks(regions) {
    const { r } = this;
    for (const g of regions) {
      if (g.tiles.some((p) => this.lotOf[this.i(p.x, p.y)] >= 0)) continue;
      const p = g.touchesWater ? 0.5 : 0.1;
      if (g.tiles.length >= 6 && r.chance(p)) {
        for (const q of g.tiles) this.tiles[this.i(q.x, q.y)] = TILE.PARK;
      }
    }
  }

  fillLots() {
    const { r, cols, rows } = this;
    const shapes = [[2, 2], [2, 2], [2, 1], [1, 2], [3, 2], [2, 3], [1, 1], [2, 1], [1, 2]];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const id = this.i(x, y);
        if (this.tiles[id] !== TILE.GROUND || this.lotOf[id] >= 0) continue;
        const tries = r.shuffle(shapes.slice());
        tries.push([1, 1]);
        for (const [w, h] of tries) {
          if (this.areaFree(x, y, w, h)) { this.addLot(x, y, w, h, 'building'); break; }
        }
      }
    }
  }

  areaFree(x, y, w, h) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) return false;
        const id = this.i(nx, ny);
        if (this.tiles[id] !== TILE.GROUND || this.lotOf[id] >= 0) return false;
      }
    }
    return true;
  }

  lotAccess(x, y, w, h) {
    const out = [];
    const push = (ax, ay) => { if (this.isRoad(ax, ay)) out.push({ x: ax, y: ay }); };
    for (let dx = 0; dx < w; dx++) { push(x + dx, y - 1); push(x + dx, y + h); }
    for (let dy = 0; dy < h; dy++) { push(x - 1, y + dy); push(x + w, y + dy); }
    return out;
  }

  addLot(x, y, w, h, kind) {
    const { r, cols, rows } = this;
    const id = this.lots.length;
    const cx = x + w / 2, cy = y + h / 2;
    const d = Math.hypot(cx - cols * 0.55, cy - rows * 0.5) / Math.hypot(cols * 0.55, rows * 0.5);
    const height = kind === 'building'
      ? Math.max(1, Math.min(7, Math.round(1 + r() * 2.2 + (1 - d) * (1 - d) * 5 * r())))
      : 2;
    const access = this.lotAccess(x, y, w, h);
    const lot = {
      id, x, y, w, h, cx, cy, kind, height,
      hue: r(), seed: r(),
      access: access.length ? access[Math.floor(access.length / 2)] : null,
      number: r.int(1, 240),
    };
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tid = this.i(x + dx, y + dy);
        this.lotOf[tid] = id;
        this.tiles[tid] = TILE.LOT;
      }
    }
    this.lots.push(lot);
    return lot;
  }

  streetName(x, y) {
    const hi = this.hRoads.indexOf(y);
    const vi = this.vRoads.indexOf(x);
    const horizontal = hi >= 0 && (this.isRoad(x - 1, y) || this.isRoad(x + 1, y));
    if (horizontal && (vi < 0 || (x + y) % 2 === 0)) return H_NAMES[hi % H_NAMES.length];
    if (vi >= 0) return V_NAMES[vi % V_NAMES.length];
    return H_NAMES[Math.max(0, hi) % H_NAMES.length];
  }

  allStreetNames() {
    return [...this.vRoads.map((_, i) => V_NAMES[i % V_NAMES.length]),
      ...this.hRoads.map((_, i) => H_NAMES[i % H_NAMES.length])];
  }

  // BFS distance field over road tiles, measured from (tx, ty).
  distanceField(tx, ty) {
    const n = this.tiles.length;
    const d = new Int32Array(n).fill(-1);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const s = this.i(tx, ty);
    d[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      const id = q[head++];
      const x = id % this.cols, y = (id / this.cols) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.isRoad(nx, ny)) continue;
        const nid = this.i(nx, ny);
        if (d[nid] < 0) { d[nid] = d[id] + 1; q[tail++] = nid; }
      }
    }
    return d;
  }

  // Walk downhill on a distance field; prefers going straight (fewer turns).
  pathFrom(field, sx, sy) {
    let x = sx, y = sy;
    if (field[this.i(x, y)] < 0) return null;
    const path = [{ x, y }];
    let pdx = 0, pdy = 0;
    while (field[this.i(x, y)] > 0) {
      const cur = field[this.i(x, y)];
      let next = null;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.isRoad(nx, ny) || field[this.i(nx, ny)] !== cur - 1) continue;
        if (!next || (dx === pdx && dy === pdy)) next = { x: nx, y: ny, dx, dy };
      }
      if (!next) break;
      x = next.x; y = next.y; pdx = next.dx; pdy = next.dy;
      path.push({ x, y });
    }
    return path;
  }
}
