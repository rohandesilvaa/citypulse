// Game simulation: spawns calls, feeds them to the AI one by one, and turns
// Laya's decisions into unit dispatches on the map. Dispatch is plain code;
// the only thing the model decides is service + urgency (+ incident type).
import { rng, TILE } from './city.js';
import { pickScenario, fillTemplate, makeCaller, SERVICES } from './calls.js';

export const URG_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const DEADLINE = { critical: 55, high: 75, medium: 100, low: 140 };   // game seconds from the call
const BASE_POINTS = { critical: 300, high: 200, medium: 120, low: 60 };
const SCENE_TIME = { critical: 7, high: 6, medium: 5, low: 4 };
const SPEED_MULT = { critical: 1.4, high: 1.2, medium: 1.0, low: 0.85 };
const BASE_SPEED = 3.1;                                               // tiles / game second
export const CALL_INTERVAL = { calm: 15, normal: 9, busy: 5 };
const MAX_OPEN_CALLS = 6;
const STATION_UNIT = { fire: 'fire', hospital: 'ambulance', police: 'police' };
const UNIT_PREFIX = { fire: 'FIRE', ambulance: 'MED', police: 'POL' };
const CAR_COLORS = ['#5b6b82', '#7c8797', '#4a5568', '#8a6f5a', '#6b5b82', '#51707a', '#9aa4b1', '#6d7c63'];

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export class Game {
  constructor(city, ai, hooks = {}) {
    this.city = city;
    this.ai = ai;
    this.h = hooks;
    this.r = rng((Date.now() % 1e9) | 0);
    this.t = 0;
    this.speed = 1;
    this.paused = true;
    this.rate = 'normal';
    this.nextCallAt = 2;
    this.calls = [];
    this.closed = [];
    this.vehicles = [];
    this.cars = [];
    this.nextId = 1;
    this.recent = [];
    this.current = null;
    this.homeFields = new Map();
    this.stats = {
      score: 0, decided: 0, correct: 0, urgExact: 0, urgNear: 0,
      saved: 0, pranks: 0, missed: 0, wasted: 0, wrong: 0, late: 0, handled: 0,
      latencies: [],
      confusion: Object.fromEntries(SERVICES.map((t) => [t, Object.fromEntries(SERVICES.map((p) => [p, 0]))])),
    };
    this.spawnFleet();
    this.spawnTraffic(Math.round(city.roadTiles.length / 22));
  }

  emit(name, ...args) { this.h[name]?.(...args); }

  // ------------------------------------------------------------------ setup
  spawnFleet() {
    for (const st of this.city.stations) {
      const type = STATION_UNIT[st.kind];
      const horizontal = st.w >= st.h;
      for (let k = 0; k < 2; k++) {
        const off = (k - 0.5) * (horizontal ? Math.min(1.1, st.w * 0.36) : Math.min(1.1, st.h * 0.36));
        const slot = horizontal ? { x: st.cx + off, y: st.cy + 0.15 } : { x: st.cx + 0.15, y: st.cy + off };
        const n = this.vehicles.filter((v) => v.type === type).length + 1;
        this.vehicles.push({
          id: `${UNIT_PREFIX[type]}-${n}`, type, station: st, slot,
          parkAngle: horizontal ? -Math.PI / 2 : 0,
          pos: { ...slot }, angle: horizontal ? -Math.PI / 2 : 0, targetAngle: horizontal ? -Math.PI / 2 : 0,
          path: null, pi: 0, state: 'idle', call: null, siren: false, speed: BASE_SPEED,
        });
      }
    }
  }

  spawnTraffic(n) {
    const { r, city } = this;
    for (let k = 0; k < n; k++) {
      const tile = r.pick(city.roadTiles);
      const nb = city.roadNeighbors(tile.x, tile.y);
      const next = r.pick(nb);
      this.cars.push({
        pos: { x: tile.x + 0.5, y: tile.y + 0.5 },
        from: tile, to: next,
        angle: Math.atan2(next.y - tile.y, next.x - tile.x),
        speed: 1.3 + r() * 1.1,
        color: r.pick(CAR_COLORS),
        len: 0.42 + r() * 0.12,
      });
    }
  }

  // ------------------------------------------------------------------ calls
  openCalls() { return this.calls.filter((c) => ['ringing', 'queued', 'analyzing'].includes(c.status)); }

  pickLot(near) {
    const { r, city } = this;
    const busy = new Set(this.calls.map((c) => c.lot.id));
    let lots = city.lots.filter((l) => l.kind === 'building' && l.access && !busy.has(l.id));
    if (near === 'coast') {
      const coast = lots.filter((l) => l.access.x === 3);
      if (coast.length) lots = coast;
    }
    return r.pick(lots);
  }

  spawnCall(customText = null) {
    const { r, city } = this;
    const scenario = customText ? null : pickScenario(r, this.recent);
    const lot = this.pickLot(scenario?.near);
    if (!lot) return null;
    const street = city.streetName(lot.access.x, lot.access.y);
    const others = city.allStreetNames().filter((s) => s !== street);
    const text = customText || fillTemplate(r, r.pick(scenario.s), { street, street2: r.pick(others), num: lot.number });
    if (scenario) { this.recent.push(scenario); if (this.recent.length > 10) this.recent.shift(); }
    const call = {
      id: this.nextId++,
      text,
      custom: !!customText,
      truth: scenario?.t ?? null,
      truthUrgency: scenario?.u ?? null,
      accept: scenario?.a ?? [],
      caller: customText ? { name: 'You (custom call)', phone: 'manual' } : makeCaller(r),
      lot, access: lot.access, street,
      address: `${lot.number} ${street}`,
      spawnT: this.t,
      status: 'ringing',
      ringUntil: this.t + 1.4,
      decision: null, ai: null, unit: null, outcome: null,
    };
    this.calls.push(call);
    this.emit('onNewCall', call);
    return call;
  }

  addCustomCall(text) {
    return this.spawnCall(text.trim());
  }

  // ------------------------------------------------------------------ AI loop
  async aiLoop() {
    for (;;) {
      if (this.paused || !this.ai.ready) { await sleep(200); continue; }
      const call = this.calls.filter((c) => c.status === 'queued').sort((a, b) => a.spawnT - b.spawnT)[0];
      if (!call) { await sleep(100); continue; }
      call.status = 'analyzing';
      call.analyzeT = this.t;
      this.current = call;
      this.emit('onAnalyzeStart', call);
      try {
        // Let the caller finish speaking (transcript types out), then one forward pass.
        await sleep(Math.min(2400, 500 + call.text.length * 14) / Math.sqrt(this.speed));
        this.emit('onInference', call);
        const res = await this.ai.analyze(call.text);
        call.ai = res;
        this.applyDecision(call, res);
      } catch (err) {
        call.status = 'queued';
        this.emit('onAIError', err, call);
        await sleep(2500);
      } finally {
        this.current = null;
      }
    }
  }

  applyDecision(call, res) {
    const d = res.decision;
    call.decision = d;
    call.decideT = this.t;
    const s = this.stats;
    s.latencies.push({ ms: res.ms, ok: null, id: call.id });
    if (s.latencies.length > 40) s.latencies.shift();

    if (!call.custom) {
      const ok = d.service === call.truth || call.accept.includes(d.service);
      const diff = Math.abs(URG_RANK[d.urgency] - URG_RANK[call.truthUrgency]);
      call.eval = { ok, urgency: diff === 0 ? 'exact' : diff === 1 ? 'near' : 'off' };
      s.decided++;
      if (ok) s.correct++;
      if (diff === 0) s.urgExact++;
      else if (diff === 1) s.urgNear++;
      s.confusion[call.truth][d.service]++;
      s.latencies[s.latencies.length - 1].ok = ok;
      if (ok && d.service !== 'ignore') this.addScore(diff === 0 ? 25 : diff === 1 ? 10 : 0, null);
    }
    this.emit('onDecision', call, res);

    if (d.service === 'ignore') {
      if (call.custom) this.close(call, 'ignored', 0, 'CALL DROPPED', '#8b97ab');
      else if (call.truth === 'ignore' || call.accept.includes('ignore')) {
        this.stats.pranks += call.truth === 'ignore' ? 1 : 0;
        this.close(call, 'filtered', 60, call.truth === 'ignore' ? 'PRANK FILTERED' : 'NON-EMERGENCY', '#8b97ab');
      } else {
        this.stats.missed++;
        this.close(call, 'missed', -150, 'MISSED EMERGENCY', '#ff3b5c');
      }
      return;
    }
    call.need = d.service;
    call.status = 'waiting_unit';
    this.tryDispatch(call);
  }

  // ------------------------------------------------------------------ dispatch
  vehicleRoadTile(v) {
    if (v.state === 'idle') return v.station.access;
    for (let k = v.pi; k < (v.path?.length ?? 0); k++) {
      const p = v.path[k];
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      if (this.city.isRoad(tx, ty)) return { x: tx, y: ty };
    }
    return v.station.access;
  }

  tryDispatch(call) {
    const { city } = this;
    call.field = call.field || city.distanceField(call.access.x, call.access.y);
    let best = null, bestD = Infinity, bestStart = null;
    for (const v of this.vehicles) {
      if (v.type !== call.need || (v.state !== 'idle' && v.state !== 'returning')) continue;
      const start = this.vehicleRoadTile(v);
      const d = call.field[city.i(start.x, start.y)];
      if (d < 0) continue;
      const cost = d + (v.state === 'idle' ? 1.5 : 0);
      if (cost < bestD) { bestD = cost; best = v; bestStart = start; }
    }
    if (!best) return false;
    const tiles = city.pathFrom(call.field, bestStart.x, bestStart.y);
    const urg = call.decision.urgency;
    best.path = tiles.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    best.pi = 0;
    best.state = 'enroute';
    best.call = call;
    best.siren = URG_RANK[urg] >= 1;
    best.speed = BASE_SPEED * SPEED_MULT[urg];
    call.unit = best;
    call.status = 'dispatched';
    call.dispatchT = this.t;
    this.emit('onDispatch', call, best);
    return true;
  }

  sendHome(v) {
    const { city } = this;
    const home = v.station.access;
    const key = v.station.id;
    if (!this.homeFields.has(key)) this.homeFields.set(key, city.distanceField(home.x, home.y));
    const fx = Math.floor(v.pos.x), fy = Math.floor(v.pos.y);
    const start = city.isRoad(fx, fy) ? { x: fx, y: fy } : this.vehicleRoadTile(v);
    const tiles = city.pathFrom(this.homeFields.get(key), start.x, start.y) || [start];
    v.path = tiles.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    v.path.push({ ...v.slot });
    v.pi = 0;
    v.state = 'returning';
    v.call = null;
    v.siren = false;
    v.speed = BASE_SPEED * 0.8;
  }

  onArrive(v) {
    if (v.state === 'returning') {
      v.state = 'idle';
      v.path = null;
      v.pos = { ...v.slot };
      v.targetAngle = v.parkAngle;
      this.retryWaiting();
      return;
    }
    if (v.state !== 'enroute') return;
    const call = v.call;
    v.state = 'onscene';
    call.status = 'onscene';
    call.arriveT = this.t;
    const correct = call.custom || v.type === call.truth || call.accept.includes(v.type);
    const urg = call.custom ? call.decision.urgency : call.truthUrgency;
    v.sceneEnd = this.t + (correct && call.truth !== 'ignore' ? SCENE_TIME[urg] : 2.5);
    call.sceneStart = this.t;
    call.sceneEnd = v.sceneEnd;
    this.emit('onArrive', call, v);
  }

  finishScene(v) {
    const call = v.call;
    const s = this.stats;
    if (call.custom) {
      s.handled++;
      this.close(call, 'handled', 0, 'HANDLED', '#c084fc');
    } else if (call.truth === 'ignore' && !call.accept.includes(v.type)) {
      s.wasted++;
      this.close(call, 'wasted', -60, 'FALSE ALARM', '#8b97ab');
    } else if (v.type !== call.truth && !call.accept.includes(v.type)) {
      // Crew on scene radios back that a different service is needed.
      s.wrong++;
      this.addScore(-100, call, 'WRONG UNIT', '#ff3b5c');
      call.need = call.truth;
      call.redirected = true;
      call.status = 'waiting_unit';
      call.unit = null;
      this.emit('onRedirect', call, v);
      this.sendHome(v);
      this.tryDispatch(call);
      return;
    } else {
      const elapsed = call.arriveT - call.spawnT;
      const limit = DEADLINE[call.truthUrgency];
      let pts = BASE_POINTS[call.truthUrgency];
      if (call.redirected) pts *= 0.5;
      if (elapsed <= limit) {
        pts *= 1 + 0.5 * (1 - elapsed / limit);
        if (URG_RANK[call.truthUrgency] >= 2 && !call.redirected) s.saved++;
        this.close(call, call.redirected ? 'recovered' : 'saved', Math.round(pts), call.redirected ? 'RECOVERED' : 'RESOLVED', '#2ee6a6');
      } else {
        s.late++;
        this.close(call, 'late', Math.round(pts * 0.35), 'TOO LATE', '#ff8a3d');
      }
    }
    this.sendHome(v);
  }

  close(call, outcome, points, label, color) {
    call.outcome = outcome;
    call.points = points;
    call.status = 'resolved';
    call.closeT = this.t + 4;
    if (call.unit) call.unit = null;
    this.addScore(points, call, label, color);
    this.emit('onResolved', call);
  }

  addScore(points, call, label, color) {
    this.stats.score += points;
    if (call && label) this.emit('onFloat', call, label, points, color);
  }

  retryWaiting() {
    const waiting = this.calls.filter((c) => c.status === 'waiting_unit')
      .sort((a, b) => URG_RANK[b.decision.urgency] - URG_RANK[a.decision.urgency] || a.spawnT - b.spawnT);
    for (const c of waiting) this.tryDispatch(c);
  }

  // ------------------------------------------------------------------ update
  update(realDt) {
    if (this.paused) return;
    const dt = Math.min(realDt, 0.1) * this.speed;
    this.t += dt;

    if (this.t >= this.nextCallAt) {
      if (this.openCalls().length < MAX_OPEN_CALLS) {
        this.spawnCall();
        const base = CALL_INTERVAL[this.rate];
        this.nextCallAt = this.t + base * (0.65 + this.r() * 0.7);
      } else {
        this.nextCallAt = this.t + 1;
      }
    }

    for (const c of this.calls) {
      if (c.status === 'ringing' && this.t >= c.ringUntil) c.status = 'queued';
    }
    const before = this.calls.length;
    this.calls = this.calls.filter((c) => {
      if (c.status === 'resolved' && this.t >= c.closeT) {
        this.closed.push(c);
        return false;
      }
      return true;
    });
    if (this.calls.length !== before) this.emit('onCallsChanged');

    for (const v of this.vehicles) {
      if (v.path) this.moveAlong(v, dt);
      else if (v.state === 'onscene' && this.t >= v.sceneEnd) this.finishScene(v);
      this.turn(v, dt);
    }
    if (this.calls.some((c) => c.status === 'waiting_unit')) this.retryWaiting();

    for (const car of this.cars) this.moveCar(car, dt);
  }

  moveAlong(v, dt) {
    let remain = v.speed * dt;
    while (remain > 0 && v.path && v.pi < v.path.length) {
      const p = v.path[v.pi];
      const dx = p.x - v.pos.x, dy = p.y - v.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-4) v.targetAngle = Math.atan2(dy, dx);
      if (d <= remain) {
        v.pos.x = p.x; v.pos.y = p.y;
        remain -= d;
        v.pi++;
      } else {
        v.pos.x += (dx / d) * remain;
        v.pos.y += (dy / d) * remain;
        remain = 0;
      }
    }
    if (v.path && v.pi >= v.path.length) {
      v.path = null;
      this.onArrive(v);
    }
  }

  turn(o, dt) {
    let diff = o.targetAngle - o.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    o.angle += diff * Math.min(1, dt * 12);
  }

  moveCar(car, dt) {
    const { city, r } = this;
    let remain = car.speed * dt;
    while (remain > 0) {
      const tx = car.to.x + 0.5, ty = car.to.y + 0.5;
      const dx = tx - car.pos.x, dy = ty - car.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-4) car.targetAngle = Math.atan2(dy, dx);
      if (d <= remain) {
        car.pos.x = tx; car.pos.y = ty;
        remain -= d;
        const nb = city.roadNeighbors(car.to.x, car.to.y);
        const fwd = nb.filter((p) => p.x !== car.from.x || p.y !== car.from.y);
        const straight = fwd.find((p) => p.x - car.to.x === car.to.x - car.from.x && p.y - car.to.y === car.to.y - car.from.y);
        const next = straight && r.chance(0.7) ? straight : (fwd.length ? r.pick(fwd) : car.from);
        car.from = car.to;
        car.to = next;
      } else {
        car.pos.x += (dx / d) * remain;
        car.pos.y += (dy / d) * remain;
        remain = 0;
      }
    }
    this.turn(car, dt);
  }

  // ------------------------------------------------------------------ helpers for UI
  deadlineFraction(call) {
    if (call.custom || !call.truthUrgency || call.truth === 'ignore') return null;
    const limit = DEADLINE[call.truthUrgency];
    return Math.max(0, 1 - (this.t - call.spawnT) / limit);
  }

  fleetSummary() {
    const out = {};
    for (const v of this.vehicles) (out[v.type] ||= []).push(v);
    return out;
  }
}

export { TILE };
