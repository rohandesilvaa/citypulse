#!/usr/bin/env python3
"""
CityPulse (Laya Dispatch) - local server.

Serves the game from ./public and runs the Laya decision model
(https://huggingface.co/convaiinnovations/laya) in-process on this Mac.

  GET  /api/status     -> model loading state
  GET  /api/questions  -> the typed questions sent to Laya with every call
  POST /api/decide     -> {"transcript": "..."} -> Laya's typed answers + probabilities
"""
import http.server
import json
import os
import sys
import threading
import time

os.environ.setdefault("USE_TF", "0")               # avoids a transformers/TensorFlow import deadlock
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# fp16 weights on MPS need fp16 autocast on EVERY call: Laya only enables it from 5 question rows
# by default, and a smaller call would mix fp32 inputs with fp16 weights and abort in Metal.
os.environ.setdefault("LAYA_MPS_AMP_MIN_ROWS", "1")

PORT = int(os.environ.get("PORT", "8080"))
MODEL_ID = os.environ.get("LAYA_MODEL", "convaiinnovations/laya")
SUBFOLDER = os.environ.get("LAYA_SUBFOLDER") or None   # e.g. "multilingual"
DEVICE = os.environ.get("LAYA_DEVICE") or None         # None = auto (mps on Apple Silicon)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

# ---------------------------------------------------------------------------------------------
# The typed questions Laya answers for every call - all in ONE forward pass. Laya scores each
# option at its own [MASK] token and returns a calibrated probability for every option; it
# never generates text.
#
# Service = 30% of the 4-way "service" choice + 70% of the matching yes/no check. The yes/no
# checks are where the base checkpoint is strongest (NLI-style), and the blend measured
# 95% on the game's scenarios vs 90% for the choice alone (see README).
# ---------------------------------------------------------------------------------------------
def _yes_no(instructions):
    # Neutral keys: the model card recommends this over `noul` for the English checkpoint.
    return {"type": "choice", "instructions": instructions, "criteria": {"A": "yes", "B": "no"}}


SERVICES = ["fire", "ambulance", "police", "ignore"]
URGENCIES = ["low", "medium", "high", "critical"]
CHECKS = {"fire": "is_fire", "ambulance": "is_hurt", "police": "is_crime", "ignore": "is_prank"}
CHOICE_WEIGHT = 0.3

QUESTIONS = {
    "service": {
        "type": "choice",
        "instructions": "Which emergency service should the dispatcher send to this caller?",
        "criteria": {
            "police": "police: crime, break-in, theft, fighting, weapon, threat, hit and run, drunk driver, traffic lights, suspicious person, noise, dangerous or annoying animal",
            "ambulance": "ambulance: someone is injured, bleeding, bitten, fell, collapsed, unconscious, not breathing, in pain, having a baby, or sick",
            "ignore": "no one: prank call, joke, laughing, fake story, wrong number, question, food order, birthday party, not an emergency",
            "fire": "fire brigade: fire, smoke, burning, explosion, gas leak, sparks, or a person or animal trapped or stuck",
        },
    },
    "is_fire": _yes_no("Is something on fire, smoking, exploding or leaking gas, or is someone trapped and needs rescue?"),
    "is_hurt": _yes_no("Is a person injured, bleeding, bitten, sick, unconscious or having a medical emergency?"),
    "is_crime": _yes_no("Is there a crime, a fight, a threat, a dangerous driver or a nuisance caused by people or animals?"),
    "is_prank": _yes_no("Is the caller joking, pranking, or asking for something that is not an emergency?"),
    "urgency": {
        "type": "score",
        "instructions": "How urgent is this emergency call?",
        "criteria": [
            "minor or not an emergency",
            "a real problem but no danger to anyone",
            "serious, someone could get hurt soon",
            "someone's life is in danger right now",
        ],
    },
    "incident": {
        "type": "choice",
        "instructions": "What kind of incident is the caller reporting?",
        "criteria": {
            "Building fire": "a house, shop, factory or building is on fire or smoking",
            "Vehicle fire": "a car, bus, truck or vehicle is burning",
            "Gas leak / explosion": "gas smell, gas leak, cylinder or explosion",
            "Rescue needed": "a person or animal is trapped, stuck or fell somewhere",
            "Traffic accident": "a crash or collision between vehicles or with a person",
            "Medical emergency": "illness, collapse, breathing problem, chest pain, seizure, childbirth",
            "Injury": "bleeding, cut, fall, broken bone, bite",
            "Crime in progress": "break-in, burglary, intruder, robbery, theft, snatching",
            "Violence / threat": "fight, weapon, knife, threat, abuse",
            "Traffic hazard": "drunk or reckless driver, broken traffic lights, blocked road",
            "Public nuisance": "noise, loud music, annoying animal, dispute, overcharging",
            "Prank / non-emergency": "joke, prank, fake story, wrong number, question, food order",
        },
    },
}


def combine(answers):
    """Turn Laya's typed answers into one dispatch decision (plain arithmetic, no rules)."""
    choice = answers["service"]["probabilities"]
    checks = {svc: answers[q]["probabilities"]["A"] for svc, q in CHECKS.items()}
    raw = {svc: CHOICE_WEIGHT * choice[svc] + (1 - CHOICE_WEIGHT) * checks[svc] for svc in SERVICES}
    total = sum(raw.values()) or 1.0
    service_p = {svc: round(v / total, 4) for svc, v in raw.items()}
    service = max(service_p, key=service_p.get)

    u = answers["urgency"]
    urgency_p = {URGENCIES[int(k)]: v for k, v in u["probabilities"].items()}
    urgency = "low" if service == "ignore" else URGENCIES[min(3, round(u["score"]))]

    inc = answers["incident"]
    return {
        "service": service,
        "urgency": urgency,
        "urgency_score": u["score"],
        "incident": inc["choice"],
        "confidence": service_p[service],
        "probs": {"service": service_p, "service_choice": choice, "checks": checks,
                  "urgency": urgency_p, "incident": inc["probabilities"]},
    }


class Model:
    def __init__(self):
        self.state = "loading"
        self.error = None
        self.agent = None
        self.device = None
        self.load_seconds = None
        self.lock = threading.Lock()
        self.last_request = 0.0
        self.last_use = 0.0

    def load(self):
        t0 = time.time()
        try:
            import laya
            kwargs = {}
            if SUBFOLDER:
                kwargs["subfolder"] = SUBFOLDER
            if DEVICE:
                kwargs["device"] = DEVICE
            print(f"  ⏳ Loading {MODEL_ID}{'/' + SUBFOLDER if SUBFOLDER else ''} "
                  f"(first run downloads the checkpoint from Hugging Face)…", flush=True)
            agent = laya.load(MODEL_ID, **kwargs)
            self.device = str(getattr(agent, "device", "cpu"))
            if self.device.startswith("mps") and getattr(agent, "amp_enabled", False) and agent.mps_amp_min_rows <= 1:
                # MPS already computes in fp16 (autocast); storing the weights in fp16 too halves
                # memory (~0.9 GB) with identical answers - it matters on 8 GB Macs.
                agent.model.half()
            # Warm-up pass so the first real call is fast.
            agent.predict({"caller_transcript": "Hello, there is a fire in my kitchen."}, QUESTIONS)
            self.agent = agent
            self.load_seconds = round(time.time() - t0, 1)
            self.state = "ready"
            print(f"  ✅ Laya ready on {self.device} in {self.load_seconds}s", flush=True)
        except Exception as exc:  # noqa: BLE001 - surface any load failure to the UI
            self.state = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            print(f"  ❌ Failed to load Laya: {self.error}", file=sys.stderr, flush=True)

    def keep_warm(self):
        """While a game is running, run a tiny pass when idle so the weights stay resident and
        the GPU stays clocked up (otherwise macOS pages the idle model out between calls)."""
        while True:
            time.sleep(1.0)
            now = time.time()
            if self.state != "ready" or now - self.last_request > 90 or now - self.last_use < 3:
                continue
            with self.lock:
                self.agent.predict({"caller_transcript": "Hello, is anyone there?"}, QUESTIONS)
                self.last_use = time.time()

    def decide(self, transcript):
        self.last_request = time.time()
        with self.lock:
            t0 = time.perf_counter()
            result = self.agent.predict({"caller_transcript": transcript}, QUESTIONS)
            ms = (time.perf_counter() - t0) * 1000
            self.last_use = time.time()
        return {"decision": combine(result["answers"]), "answers": result["answers"],
                "ms": round(ms, 1), "device": self.device}


MODEL = Model()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/status":
            return self.send_json({
                "state": MODEL.state, "error": MODEL.error, "model": MODEL_ID + (f"/{SUBFOLDER}" if SUBFOLDER else ""),
                "device": MODEL.device, "load_seconds": MODEL.load_seconds,
            })
        if self.path == "/api/questions":
            return self.send_json(QUESTIONS)
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/decide":
            return self.send_error(404)
        if MODEL.state != "ready":
            return self.send_json({"error": f"Laya is {MODEL.state}", "detail": MODEL.error}, 503)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            transcript = str(payload.get("transcript", "")).strip()[:2000]
            if not transcript:
                return self.send_json({"error": "empty transcript"}, 400)
            return self.send_json(MODEL.decide(transcript))
        except Exception as exc:  # noqa: BLE001
            return self.send_json({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") or self.path.endswith((".js", ".css", ".ico")):
            return
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    threading.Thread(target=MODEL.load, daemon=True).start()
    if os.environ.get("LAYA_KEEP_WARM", "1") != "0":
        threading.Thread(target=MODEL.keep_warm, daemon=True).start()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"\n  🚨 CityPulse running at  http://localhost:{PORT}\n"
          f"     Decision model: {MODEL_ID} (Laya, runs locally)\n"
          f"     Press Ctrl+C to stop.\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Bye 👋")


if __name__ == "__main__":
    main()
