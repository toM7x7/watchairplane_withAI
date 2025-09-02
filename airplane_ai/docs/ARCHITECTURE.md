# アーキテクチャ概要

## コンポーネント
- Web（Three.js + WebXR）
  - デスクトップ: OrbitControlsでフォールバック
  - AR: hit-test/anchors/plane/hand、3Dチャットパネル
  - チャットUI（HTML）: ペルソナ/文脈/読み上げ
  - フライト更新: SSE（fallback: ポーリング）
- flight-proxy（Express）
  - `/flights` `/flights/stream` `/chat` `/health` `/`
  - OpenSky連携（envで切替）/モック返却/キャッシュ
- tts（FastAPI）
  - `/speak`（スタブ）

## データフロー
- Web → flight-proxy: フライト取得（SSE/HTTP）、チャット（Gemini or スタブ）
- Web → tts: 読み上げ（将来差し替え想定）
- WebXR: 位置情報→ENU変換→機体配置、plane検出→3Dパネル配置

## 環境変数
- `FLIGHT_PROVIDER`, `OPENSKY_USER`, `OPENSKY_PASS`
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `CACHE_TTL_MS`

## デプロイ（GCP）
- 推奨: GCS + Cloud CDN（web） + Cloud Run（api/tts）
- 代替: Firebase Hosting + Cloud Run / 単一Cloud Run / LB+API Gateway など

