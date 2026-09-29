// Laya client. Laya (convaiinnovations/laya) is a non-generative "System 1" decision model:
// the local server runs it on this Mac and it answers typed questions about each call with a
// calibrated probability for every option, in a single forward pass. Nothing leaves the Mac.
import { SERVICES, URGENCIES } from './calls.js';

export class LayaClient {
  constructor(base = '/api') {
    this.base = base;
    this.ready = false;
    this.model = 'laya';
    this.device = null;
    this.questions = null;
  }

  async status() {
    const res = await fetch(`${this.base}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();
    this.model = s.model || this.model;
    this.device = s.device;
    return s;
  }

  async loadQuestions() {
    if (!this.questions) this.questions = await (await fetch(`${this.base}/questions`)).json();
    return this.questions;
  }

  async analyze(transcript) {
    const t0 = performance.now();
    const res = await fetch(`${this.base}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(body.error || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return {
      decision: toDecision(body.decision),
      answers: body.answers,
      ms: body.ms,                          // pure model time (forward pass)
      roundTrip: performance.now() - t0,
      device: body.device,
    };
  }
}

// The server blends Laya's typed answers into one decision; add a human-readable summary.
function toDecision(d) {
  const service = SERVICES.includes(d.service) ? d.service : 'police';
  const urgency = URGENCIES.includes(d.urgency) ? d.urgency : 'medium';
  const pct = (v) => `${Math.round(v * 100)}%`;
  const c = d.probs.checks;
  return {
    service,
    urgency,
    urgencyScore: d.urgency_score,
    incident: d.incident,
    confidence: Math.round(d.confidence * 100),
    probs: d.probs,
    reasoning: `Checks → fire ${pct(c.fire)} · hurt ${pct(c.ambulance)} · crime ${pct(c.police)} · prank ${pct(c.ignore)}. `
      + `Urgency score ${d.urgency_score.toFixed(2)} / 3.`,
  };
}
