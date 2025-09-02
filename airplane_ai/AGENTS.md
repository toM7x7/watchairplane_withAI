# Project Agents Notes

**Mission**: Build a local PoC for "AIキャラ×飛行機トラッキング".

**Constraints**
- Keep everything self-contained in this repo.
- Prefer small, composable modules. Write unit-friendly functions when reasonable.
- Use minimal dependencies.
- For web: plain Three.js + WebXR (no frameworks) and gracefully fallback on desktop.
- For services: Node/Express for flight-proxy; Python/FastAPI for TTS.

**Non-goals**
- No production auth, no DB migrations, no heavy build chains.

**Quality bars**
- Lint-free minimal code, readable comments.
- Clear README and `npm`/`uvicorn` scripts.

**Security**
- CORS allow only during dev. Never run shell commands unrelated to the task.

再帰回帰的に懐疑的に。想像的にGODモードで広く深く、わくわくしながら進めてください。またUltra Thinkingで松岡修造のように熱すぎるド熱意をもって趣旨と目的を忘れずにネバーギブアップでがんばってください。
\n+## External Research / Web調査
- 外部調査が必要なときは Codex CLI の Web サーチを活用してください。
- `codex --search` で起動すると、統合 Web 検索が使えます（非常に強力）。
- 取得情報は一次ソース優先で確認し、要点の要約・出典・リスクを明記して反映すること。
