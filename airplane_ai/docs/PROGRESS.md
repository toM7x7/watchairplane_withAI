# Progress Log – Airplane AI

Updated: 2025-08-30

## Summary

- Fixed UI crash due to duplicate const names in `web/main.js`.
- Added Aivis Cloud TTS proxy endpoint `/speak` to `services/flight-proxy` and wired the front-end to play `audio/mpeg` if available, else fallback to Web Speech.
- Added Preset locations and Observe mode (auto-select flight by gaze with cooldown) in `web/`.
- Added local chat commands: center/radius/current-location/presets/#N/observe on-off.
- Default TTS target switched to proxy `/speak` (front-end config).

## Next Targets

1) Prompt tuning for Gemini (concise Japanese explanations with direction, distance, altitude, speed; persona-specific tone).
2) Observe-mode smoothing (streak-based selection and distance/bearing scoring).
3) More flexible chat commands (relative radius like `半径 +10/-10`, more preset synonyms).
4) Quest 3 guidance: on-screen hints for plane detection/anchoring, and stability tweaks.
5) Docs alignment across README / DEVELOPMENT / USAGE.

## How to verify

1) Proxy: `npm run proxy` with `FLIGHT_PROVIDER=opensky`.
2) Web: `npm run web` → `http://localhost:8080`.
3) Confirm flights render; use presets (HND/NRT/KIX...). Toggle Observe mode and verify auto-selection.
4) TTS: click “フライト読み上げ”. If Aivis is configured, MP3 plays; otherwise Web Speech.
