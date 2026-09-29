import { City } from './city.js';
import { Renderer, SERVICE_ICON } from './render.js';
import { Game } from './game.js';
import { LayaClient } from './ai.js';
import { UI } from './ui.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ world
const wrap = $('mapWrap');
// wait for the first layout so the map is sized to the real window
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const box = wrap.getBoundingClientRect();
const TILE_PX = 21;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cols = clamp(Math.round(box.width / TILE_PX), 28, 72);
const rows = clamp(Math.round(box.height / TILE_PX), 20, 52);
const city = new City(cols, rows, Number(params.get('seed')) || 2026);
const renderer = new Renderer($('map'), city);
const ai = new LayaClient();
const sound = new Sound();

let ui;
const game = new Game(city, ai, {
  onNewCall: () => sound.ring(),
  onAnalyzeStart: (call) => { ui.startAnalysis(call); setPill('busy', 'Listening…'); },
  onInference: () => { ui.inference(); sound.thinking(); setPill('busy', 'Laya deciding…'); },
  onDecision: (call, res) => {
    ui.decision(call, res);
    sound.decision();
    setPill('online', `Laya ready · ${res.ms.toFixed(0)} ms`);
  },
  onDispatch: (call, v) => {
    sound.dispatch();
    ui.toast(`${SERVICE_ICON[v.type]} <b>${v.id}</b> dispatched → ${call.address}`);
  },
  onRedirect: (call, v) => {
    sound.fail();
    ui.toast(`📻 ${v.id} on scene: “Wrong unit! We need <b>${call.truth}</b> here!”`, 'bad');
  },
  onResolved: (call) => {
    ui.resolveLog(call);
    if (call.points > 0) sound.success();
    else if (call.points < 0) sound.fail();
    if (call.outcome === 'missed') ui.toast(`❌ Call #${call.id} was a real <b>${call.truth}</b> emergency - the AI ignored it`, 'bad');
  },
  onFloat: (call, label, points, color) => renderer.addFloat(call, label, points, color),
  onAIError: (err) => {
    ui.aiError(err);
    ai.ready = false;
    setPill('offline', 'AI error - reconnecting');
    connect();
  },
});
ui = new UI({ game, renderer, sound });

// ------------------------------------------------------------------ AI connection
function setPill(state, text) {
  $('aiPill').dataset.state = state;
  $('aiPillText').textContent = text;
}
function setIntro(state, html) {
  $('introStatus').dataset.state = state;
  $('introStatusText').innerHTML = html;
}

let connecting = false;
async function connect() {
  if (connecting) return;
  connecting = true;
  const t0 = performance.now();
  try {
    for (;;) {
      try {
        const st = await ai.status();
        if (st.state === 'ready') {
          ai.ready = true;
          $('modelDevice').textContent = `ModernBERT-L 421M · ${st.device}`;
          setPill('online', 'Laya ready');
          setIntro('ok', `Laya ready on <code>${st.device}</code> · ${st.model}`);
          ai.loadQuestions().then((q) => { $('promptText').textContent = JSON.stringify(q, null, 2); });
          return;
        }
        if (st.state === 'error') {
          setPill('offline', 'Model failed to load');
          setIntro('bad', `Laya failed to load: ${st.error} - check the terminal running <code>./start.sh</code>`);
        } else {
          const secs = Math.round((performance.now() - t0) / 1000);
          setPill('connecting', 'Loading Laya…');
          setIntro('checking', `Loading Laya into memory… ${secs}s <small>(first run downloads ~800 MB from Hugging Face)</small>`);
        }
      } catch {
        setPill('offline', 'Server offline');
        setIntro('bad', `Can't reach the local server. Run <code>./start.sh</code> - retrying…`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    connecting = false;
  }
}

// ------------------------------------------------------------------ controls
let started = false;
function start() {
  if (started) return;
  started = true;
  sound.unlock();
  $('intro').classList.add('out');
  setTimeout(() => { $('intro').hidden = true; }, 450);
  setPaused(false);
  game.aiLoop();
}

function setPaused(p) {
  game.paused = p;
  $('icoPause').hidden = p;
  $('icoPlay').hidden = !p;
  $('pausedBadge').hidden = !p || !started;
}

function setSpeed(s) {
  game.speed = s;
  document.querySelectorAll('#speedSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s));
}

$('btnStart').addEventListener('click', start);
$('btnPause').addEventListener('click', () => setPaused(!game.paused));
document.querySelectorAll('#speedSeg button').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
document.querySelectorAll('#rateSeg button').forEach((b) => b.addEventListener('click', () => {
  game.rate = b.dataset.rate;
  game.nextCallAt = Math.min(game.nextCallAt, game.t + 2);
  document.querySelectorAll('#rateSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('btnSound').addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  $('btnSound').classList.toggle('off', !sound.enabled);
  $('btnSound').firstElementChild.textContent = sound.enabled ? '🔊' : '🔇';
});
$('btnVoice').addEventListener('click', () => {
  ui.voice = !ui.voice;
  $('btnVoice').classList.toggle('off', !ui.voice);
  if (!ui.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  ui.toast(ui.voice ? '🗣️ Calls will be read aloud' : '🗣️ Voice off');
});
$('btnVoice').classList.add('off');

// custom call modal
function openCallModal() {
  $('callModal').hidden = false;
  setTimeout(() => $('callText').focus(), 30);
}
function closeCallModal() { $('callModal').hidden = true; }
$('btnCall').addEventListener('click', openCallModal);
$('callCancel').addEventListener('click', closeCallModal);
$('suggest').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { $('callText').value = e.target.textContent; $('callText').focus(); } });
$('callSend').addEventListener('click', () => {
  const text = $('callText').value.trim();
  if (text.length < 3) { $('callText').focus(); return; }
  if (!started) start();
  const call = game.addCustomCall(text);
  $('callText').value = '';
  closeCallModal();
  if (call) { renderer.flash(call); ui.toast('📞 Your call is in the queue'); }
});
$('callText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); $('callSend').click(); } });

// prompt viewer
$('btnPrompt').addEventListener('click', () => { $('promptModal').hidden = false; });
$('promptClose').addEventListener('click', () => { $('promptModal').hidden = true; });
for (const id of ['callModal', 'promptModal']) {
  $(id).addEventListener('mousedown', (e) => { if (e.target.id === id) $(id).hidden = true; });
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    if (e.key === 'Escape') closeCallModal();
    return;
  }
  if (e.key === 'Escape') { closeCallModal(); $('promptModal').hidden = true; }
  else if (!started && e.key === 'Enter') start();
  else if (e.code === 'Space') { e.preventDefault(); if (started) setPaused(!game.paused); else start(); }
  else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openCallModal(); }
  else if (e.key === '1' || e.key === '2' || e.key === '4') setSpeed(Number(e.key));
  else if (e.key === 'm' || e.key === 'M') $('btnSound').click();
  else if (e.key === 'v' || e.key === 'V') $('btnVoice').click();
});

// ------------------------------------------------------------------ loop
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderer.resize(), 120);
}).observe(wrap);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.update(dt);
  renderer.draw(game, now, dt);
  ui.tick(dt, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setPaused(true);
ui.initBars();
connect();
if (params.has('autostart')) start();

// Keep an eye on the local server while running.
setInterval(async () => {
  if (!ai.ready || connecting) return;
  try { const st = await ai.status(); if (st.state !== 'ready') throw new Error(); } catch { ai.ready = false; setPill('offline', 'Server offline'); connect(); }
}, 8000);

window.__dispatch = { game, city, ai, renderer };
