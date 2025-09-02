# Resume – What To Do When You Return

This checklist helps you restart quickly, verify browser/Quest experiences, and continue improvements.

## 1) Start Services (PowerShell examples)

- Set env (as needed):
```
$env:FLIGHT_PROVIDER = 'opensky'
# Optional but recommended
$env:OPENSKY_USER = '<username>'
$env:OPENSKY_PASS = '<password>'

# Gemini (chat) – optional
$env:GEMINI_API_KEY = '<your_api_key>'
# $env:GEMINI_MODEL = 'gemini-1.5-pro'

# Aivis Cloud TTS – for audio output
$env:AIVIS_BASE_URL   = 'https://<your-aivis-base>'
$env:AIVIS_API_KEY    = '<your_bearer_token>'
$env:AIVIS_MODEL_UUID = '<model_uuid>'
```
- Start:
```
npm run proxy   # http://localhost:8000
npm run web     # http://localhost:8080
```

## 2) Browser Verification (Desktop Chrome)

- Open http://localhost:8080
- Top bar:
  - Choose a preset (HND/NRT/KIX…) and set radius (50–150km)
  - Click 取得 → flights render on the grid
  - Toggle 観察モード → flight under gaze highlights/auto-selects (cooldown)
  - Click フライト読み上げ → hear audio (Aivis if configured, else Web Speech)
- Chat local commands (execute without LLM):
  - `中心 35.68, 139.76` / `半径 50` / `半径 +10` / `現在地`
  - `羽田` / `成田` / `KIX` / `JFK` …
  - `#3` （3番目を選択） / `観察 on` / `観察 off`

## 3) Quest 3 Verification (WebXR)

- Use HTTPS or a tunnel (e.g., Cloudflare Tunnel) and visit `https://<PC-IP>:8080`
- Enter AR → a green reticle appears on planes
- Select/タップ to place origin; markers appear around
- Try 観察モード → gaze to a flight → selection + HUD updates
- Optional: フライト読み上げ for audio

## 4) Immediate Next Actions

- Gemini prompt: add guidance to include cardinal directions（北/北東…）, distance, altitude, speed; keep 1–2 sentences.
- Observe mode: fine-tune angle/distance weights; add hysteresis; add a small "tracking …" badge while deciding.
- Commands: add relative moves (e.g., "東へ 5km" to shift center), expand synonyms.
- Docs: ensure README/DEVELOPMENT point to `docs/USAGE.md` and `docs/PROGRESS.md`.

## References

- Usage: `docs/USAGE.md`
- Progress: `docs/PROGRESS.md`
- Handoff: `docs/HANDOFF.md`
- Demo (JP): `docs/DEMO_JA.md`
