# 開発手順（PoC）

以後の方針・実装判断は `AGENTS.md` を参照します。

## サービス構成

- flight-proxy: Node/Express。開発時のみCORS許可。`/flights` はモックJSON返却。
- tts: FastAPI（Python）。開発時のみCORS許可。`/speak` はスタブ返却。
- web: 素のThree.js + WebXR。デスクトップはOrbitControlsでフォールバック。

## 起動

### flight-proxy

```
cd services/flight-proxy
npm install
npm start
# -> http://localhost:8000/flights
```

実データ（OpenSky）に切り替えるには環境変数を設定して起動してください。

```
# 例（PowerShell / bash）
$env:FLIGHT_PROVIDER="opensky"         # Windows PowerShell の例
export FLIGHT_PROVIDER=opensky          # bash の例

# 認証（任意、匿名はレート制限あり）
$env:OPENSKY_USER="<username>"
$env:OPENSKY_PASS="<password>"

npm start
```

クライアントからは `GET /flights?lat=<緯度>&lon=<経度>&radius=<km>` で周辺のフライトを取得します。

### tts

```
cd services/tts
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
# -> http://localhost:8001/health
```

### web（静的）

単純に `web/index.html` をブラウザで開くか、`npm run web` でローカルHTTPサーバ（8080）から配信してください。
Three.js は `web/lib/` に配置するか、無い場合はCDNへフォールバックします。

#### Quest 3（WebXR AR）メモ
- WebXRのARは「セキュアコンテキスト」が必要です。`localhost` は多くの環境で例外的に許可されますが、ヘッドセットブラウザからPCの `http://<PCのIP>:8080` にアクセスする場合はHTTPSが必要なことがあります。
- 開発ではまずデスクトップChromeでのWebXR（またはフォールバック）動作確認→Quest 3でのAR実機確認の順で検証してください。
- ARセッション開始時に端末の位置情報（Geolocation）を起点に、フライトの緯度経度をローカル座標(ENU)へ変換して可視化します。位置情報が取れない場合は東京駅付近を起点とします。
- デスクトップ（ノートPC等）のブラウザは通常、カメラベースの「immersive-ar」セッションをサポートしていません（エミュレータでの動作は可）。実際のAR表示はQuest 3のMeta Browserなど対応デバイスで確認してください。
- ARの原点配置: セッション開始後、床面に緑のレティクルが見えたら select（トリガー/タップ）で原点を設置します。以降、機体群（world）はこの原点を基準に表示されます。
- Anchors: 端末が対応していれば、原点はアンカーに結びつき、フレームごとにアンカーのPoseへ追従してドリフトを抑えます（セッションを跨ぐ永続化は未対応）。
- Plane detection: 大きな水平プレーンを検出し、簡易のAI対話パネル（キャンバス）をそこに配置します（試作）。
- Hand tracking: 親指と人差し指のピンチ開始で、レティクルが見えていれば原点設置、無ければ注視中の機体を選択します。

#### デスクトップ検証のコツ
- 画面左上の「中心(lat,lon)」で取得中心を変更できます。お住まいの地域に設定してください。
- 実データモード（OpenSky）時は、空域によっては便が少ない時間帯があります。中心と時間帯を変えて確認してください。
- Immersive Web Emulator を使っている場合、コンソールに `[Immersive Web Emulator] native WebXR API successfully overridden` と表示されます。ARボタンが表示される挙動は正常です。

## エンドポイント

- フライト取得: `GET http://localhost:8000/flights`
- フライトSSE: `GET http://localhost:8000/flights/stream?lat=..&lon=..&radius=..&interval=3000`
- TTSスタブ: `POST http://localhost:8001/speak`（JSON: `{ text, voice? }`）
- チャット（Gemini経由/スタブ）: `POST http://localhost:8000/chat`（JSON: `{ input }`）

## セキュリティ（開発）

## 対話（Gemini）
- 低遅延な応答体験のため、フロントは `POST /chat` を叩きます。
- 実接続: `services/flight-proxy` に `GEMINI_API_KEY` を設定して起動。

```
# 例（PowerShell / bash）
$env:GEMINI_API_KEY = "<your_api_key>"
npm run proxy
```

- 未設定時はスタブ応答にフォールバックします。

- CORSは開発中のみワイドオープン。本番に相当する運用では無効化してください。
## 使い方メモ（UI）
- 画面左上の「中心(lat,lon)」「半径km」「取得」で対象エリアの機体を更新
- 右側「フライト一覧」をクリックで該当機体を選択（3D側でハイライト）
- XRコントローラのselectまたは視線で選択（AR時）
- 「表示切替」で機体とラベルの表示/非表示
- 「非選択」で選択解除（背景クリックでも解除可）
- 選択中は上部にHUD（距離/方位/高度/速度）を表示。数値UIと重ならないよう左上に配置
# 開発手順（PoC）

以後の方針・実装判断は `AGENTS.md` を参照します。

## 概要（現在の機能）
- Web: Three.js + WebXR（Quest 3対応、デスクトップはフォールバック）
  - AR: hit-testによる原点設置、anchorsで安定化、plane-detectionで平面検出、hand-tracking（ピンチ選択）
  - 3Dチャットパネル: 最大プレーン上にCanvasベースUIを表示（読み取り用）
  - HTMLチャットUI: ペルソナ/文脈/読み上げの切替、タイプライター演出、Enter送信
  - ストリーミング: SSE（3秒間隔）でフライト更新（非対応時はポーリング10秒）
- flight-proxy: `/flights`（モック/実データOpenSky）と `/flights/stream`（SSE）、`/chat`（Gemini or スタブ）
- tts: `/speak`（スタブ）

## サービス構成
- flight-proxy: Node/Express。開発時のみCORS許可。`/flights` はモックJSON返却 or OpenSky実データ。
- tts: FastAPI（Python）。開発時のみCORS許可。`/speak` はスタブ返却。
- web: 素のThree.js + WebXR。デスクトップはOrbitControlsでフォールバック。

## 起動

### flight-proxy

```
cd services/flight-proxy
npm install
npm start
# -> http://localhost:8000/
```

実データ（OpenSky）に切り替えるには環境変数を設定して起動してください。

```
# PowerShell / bash 例
$env:FLIGHT_PROVIDER="opensky"      # PowerShell
export FLIGHT_PROVIDER=opensky       # bash

# 認証（任意、匿名はレート制限あり）
$env:OPENSKY_USER="<username>"
$env:OPENSKY_PASS="<password>"

# Gemini（任意）
$env:GEMINI_API_KEY="<your_key>"
$env:GEMINI_MODEL="gemini-pro"

npm start
```

エンドポイント（開発）
- `GET /`（インデックス）
- `GET /health`
- `GET /flights?lat&lon&radius`
- `GET /flights/stream?lat&lon&radius&interval`（SSE）
- `POST /chat`（JSON: `{ input, system?, history?, flight? }`）

### tts

```
cd services/tts
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
# -> http://localhost:8001/health
```

### web（静的）

```
npm run web
# -> http://localhost:8080
```
Three.js は `web/lib/` に配置するか、無い場合はCDNへフォールバックします。

## UI操作メモ
- 画面左上: 中心(lat,lon)/半径kmを設定 → 「取得」で更新。「現在地」で中心を現在地に。
- 右側リスト: クリックで該当機体を選択（3D側でハイライト&注視）
- 背景クリック or 「非選択」ボタン: 選択解除（ラベルは注視/選択時のみ表示）
- 右上: `source | flights:N`（データソースと件数）
- 左下チャット: ペルソナ/文脈/読み上げ切替、タイプライター演出、クリア/スキップ、Enter送信
- 3Dパネル: AR時に最大プレーン上へチャット要約を表示（読み取り専用）

## AR（Quest 3）メモ
- セキュアコンテキスト必須。`localhost` は例外的に許可されるが、PCのIPへアクセスする場合はHTTPSが必要なことがあります。
- デスクトップブラウザは通常 immersive-ar 非対応（エミュレータは可）。実機はQuest 3のMeta Browser等で確認してください。
- 原点設置: AR開始後、床に緑のレティクルが出たらSelect/タップ（またはピンチ）で原点を設置。
- Anchors: 対応端末では原点をアンカーで安定化。
- Plane detection: 大きな水平プレーンを可視化、中央に3Dチャットパネルを配置。
- Hand tracking: 親指+人差し指のピンチ開始で、レティクル可視なら原点設置、不可視なら注視選択。

## ストリーミング（SSE）
- 既定で `EventSource` により3秒間隔の更新を受信。非対応環境では10秒ポーリングへフォールバック。
- 詳細: `docs/STREAMING.md`

## 対話UI
- 詳細: `docs/CHAT.md`
- サーバ側 `/chat` は `system`（ペルソナ）、`history`（最大10件）、`flight`（選択機体メタ）に対応。

## 環境変数（例）
- `FLIGHT_PROVIDER=opensky`
- `OPENSKY_USER` / `OPENSKY_PASS`
- `GEMINI_API_KEY` / `GEMINI_MODEL`
- `CACHE_TTL_MS`（既定 5000）

## セキュリティ（開発）
- CORSは開発中のみワイドオープン。本番に相当する運用では必ずオリジンを制限してください。
