# 🚨 CityPulse: Laya Dispatch

*Emergency call triage in one forward pass.* A showcase for the Laya decision model.

A city-map dispatch game that runs itself. Emergency calls come in from all over the city
(*"My house is on fire!"*, *"A taxi crashed…"*, *"The neighbour's dog keeps chasing me…"*, prank calls).
**[Laya](https://huggingface.co/convaiinnovations/laya)** runs locally on your Mac. For every call it decides:

- **service**: 🔥 fire / 🚑 ambulance / 🚨 police / 🚫 ignore (prank)
- **urgency**: critical / high / medium / low
- **incident type**: 12 categories (used as the map label)

Laya is a *non-generative* "System 1" decision model (ModernBERT-large, 421M). It gets the call
plus typed questions and returns a **calibrated probability for every option in one forward pass**.
It generates no text, so there's nothing to parse. The UI shows those probabilities live.

Plain code handles the rest: it picks the nearest free unit (BFS on the road grid), drives it
across the map, and scores the outcome against each scripted call's hidden ground truth.

## Run it

```bash
./start.sh
```

On the first run this:
1. creates `.venv/` and runs `pip install laya`
2. downloads the Laya checkpoint (~800 MB) from Hugging Face into `~/.cache/huggingface`
3. starts the server at <http://localhost:8080> and opens your browser

It runs on the Apple GPU (`mps`) automatically. Click **Start shift** and it plays itself.

| Key | Action |
| --- | --- |
| `Space` | pause / resume |
| `C` | make your own call (type any English emergency) |
| `1` `2` `4` | game speed |
| `M` / `V` | sound / read calls aloud |

Options: `PORT=9000 ./start.sh`, `LAYA_DEVICE=cpu ./start.sh`, `?seed=7` in the URL for a different city.

## How it works

```
public/js/calls.js   scripted English calls + hidden truth (the model never sees the truth)
server.py            runs Laya in-process: POST /api/decide → agent.predict(state, QUESTIONS)
public/js/ai.js      client: turns Laya's typed answers into a decision
public/js/game.js    simulation: call queue → Laya → dispatch → travel → on-scene → score
public/js/city.js    procedural city (coast, river, roads, blocks, stations) + BFS pathfinding
public/js/render.js  canvas renderer (night city, sirens, fire/smoke, routes)
public/js/ui.js      call queue, probability bars, decision log, confusion matrix
```

The questions Laya answers are defined in `QUESTIONS` in `server.py`. Edit the option
descriptions to change how it decides. **View questions** in the app shows them, plus the last raw answer.

**Scoring:** right unit, on time = points (more for critical calls). Wrong unit = the crew radios back
and the right service gets re-dispatched late. A prank that gets a unit = wasted unit. A real
emergency marked "ignore" = missed emergency.
