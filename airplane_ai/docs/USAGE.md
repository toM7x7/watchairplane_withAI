# Usage – Airplane AI (PoC)

This document summarizes how to run the PoC with real flight data, Gemini chat, and Aivis Cloud TTS, and how to operate the UI from both the toolbar and chat.

## Quick Start (PowerShell examples)

1) Start proxy (flights + chat + TTS):

```
$env:FLIGHT_PROVIDER = 'opensky'
$env:OPENSKY_USER = '<username>'       # optional but recommended
$env:OPENSKY_PASS = '<password>'

$env:GEMINI_API_KEY = 'AIzaSyBs_-lQIljNugaXUwDUtbJ3KRnnIr5tO9Y' # optional (chat uses stub if unset)
# $env:GEMINI_MODEL = 'gemini-2.0-flash'

$env:AIVIS_BASE_URL  = 'https://api.aivis-project.com/v1/tts/synthesize'
$env:AIVIS_API_KEY   = 'aivis_qTQEHGzRpz8fFhFC4kdPb8TpBZvwdxGY'
$env:AIVIS_MODEL_UUID = '80fe2db4-5891-4550-a3f3-dff9a91c0946'

npm run proxy   # http://localhost:8000
```

2) Start web:

```
npm run web    # http://localhost:8080
```

- Quest 3: use HTTPS or a tunnel (e.g., Cloudflare Tunnel). Visit `https://<PC-IP>:8080`.
- TTS stub (`npm run tts`) is optional and returns JSON only; Aivis TTS via `/speak` is preferred for audio.

## Controls (Toolbar)

- Center: set lat/lon, “現在地”, radius, “取得”, “表示切替”, “非選択”
- Preset: choose from HND/NRT/KIX/ITM/NGO/FUK/OKA/JFK/LAX/LHR
- 観察モード: selects the flight closest to your gaze direction (desktop = camera forward)
- フライト読み上げ: reads a short line about the nearest flight

## Controls (Chat – local commands)

Type these into the chat input; they execute immediately without calling the LLM.

- `中心 35.68, 139.76` – set center
- `半径 50` – set radius (km)
- `現在地` – center to current location (requires permission)
- `羽田` / `成田` / `KIX` / `JFK` … – jump to preset area
- `#3` – select flight number 3
- `観察 on` / `観察 off` – toggle observe mode

## Audio (TTS)

- Front-end calls proxy `/speak`; when it returns `audio/mpeg`, audio plays immediately.
- If `/speak` is not configured, falls back to Web Speech API (browser-provided).

## Notes

- OpenSky availability and rate limits vary by time and region; try busy areas (HND/NRT/KIX) and adjust radius.
- On desktop, WebXR is emulated; actual AR reticle/planes/anchors require Quest 3 (or another WebXR-capable device).
