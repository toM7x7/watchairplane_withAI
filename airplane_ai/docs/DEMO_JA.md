# デモ手順（日本語）

このドキュメントは、Airplane AI（PoC）をデスクトップとQuest 3でデモする方法を日本語でまとめたものです。

## 0) 前提
- Node.js 18+（動作確認: Node 20）
- PowerShell での例を記載
- データ取得用のプロキシと、静的Webサーバをローカルで立てます
- エントリ: `web/index.html` は `./app.js`（安定版）を読み込み

## 1) 起動（デスクトップ共通）
1. プロキシ（フライト/チャット/TTS）
```
# OpenSky を使う場合は認証推奨（未設定だと制限が厳しい）
$env:FLIGHT_PROVIDER = 'opensky'
$env:OPENSKY_USER = '<username>'
$env:OPENSKY_PASS = '<password>'

npm run proxy   # 既定 http://localhost:8000
```
2. Web（静的配信）
```
npm run web     # http://localhost:8080
```
3. 動作確認（PCブラウザ）
- http://localhost:8080 を開く
- プリセットを選び「移動」→「取得」
- 右上バッジに `source: ... | flights: N` と表示され、グリッドと機体が描画される

補助エンドポイント
- ヘルスチェック: http://localhost:8000/health → `{ ok: true }`
- フライト取得: http://localhost:8000/flights?lat=35.68&lon=139.76&radius=30

## 2) Quest 3 でのデモ
WebXR の仕様上、HTTPS が原則です。簡易に試す方法（A）と、推奨のHTTPS運用（B）を記載します。

A) 手早い: HTTP を安全扱いにする（デモ用）
1. Quest のブラウザで `chrome://flags/#unsafely-treat-insecure-origin-as-secure` を開く
2. 有効化し、オリジン欄に `http://<PC-IP>:8080` を追加
3. ブラウザを再起動
4. `http://<PC-IP>:8080` を開く → AR ボタン → カメラ/モーション許可
5. 床にレティクルが出たら「タップ/Select」で原点設置 → マーカーが周囲に表示

B) 推奨: HTTPS で配信
B-1) Cloudflare Tunnel（簡単）
1. PC に cloudflared を導入
2. Web を公開: `cloudflared tunnel --url http://localhost:8080` → 例 `https://web-xxx.trycloudflare.com`
3. Proxy も公開: `cloudflared tunnel --url http://localhost:8000` → 例 `https://api-xxx.trycloudflare.com`
4. `web/index.html` の `</body>` 直前などに、接続先を上書きするスニペットを追記:
```
<script>
  window.AI_CONFIG = {
    FLIGHT_PROXY: 'https://api-xxx.trycloudflare.com'
  };
  // 他に分けたい場合: CHAT_API / TTS_API も指定可
</script>
```
5. Quest で `https://web-xxx.trycloudflare.com` を開く → AR ボタン

B-2) ローカルHTTPS（mkcert）
1. `mkcert -install` → `mkcert localhost`
2. PowerShell:
```
$env:HTTPS = '1'
$env:SSL_KEY_FILE = 'C:\\path\\to\\localhost-key.pem'
$env:SSL_CRT_FILE = 'C:\\path\\to\\localhost.pem'
npm run web   # https://localhost:8080
```
3. ページが HTTPS の場合、Proxy も HTTPS にするか、Cloudflare Tunnel経由の HTTPS を `AI_CONFIG.FLIGHT_PROXY` で指定（Mixed Content 回避）

## 3) 接続先の上書き（AI_CONFIG）
別ポートやHTTPSのエンドポイントへ切り替えるときは、`app.js` より前に以下を置きます。
```
<!-- web/index.html で app.js より前に配置 -->
<script>
  window.AI_CONFIG = {
    FLIGHT_PROXY: 'http://localhost:8001',  // 例: Proxy を 8001 番で起動
    // CHAT_API: '...'
    // TTS_API: '...'
  };
</script>
<script type="module" src="./app.js"></script>
```

## 4) トラブルシュート
- ポート競合: `Error: listen EADDRINUSE :::8000`
  - 使用中を確認: `netstat -ano | findstr :8000` または `Get-NetTCPConnection -LocalPort 8000`
  - 終了: `taskkill /PID <PID> /F` または `Stop-Process -Id <PID> -Force`
  - 再試行: `npm run proxy`
  - 代替: 別ポートで起動 → `PowerShell> $env:PORT = 8001; npm run proxy` → `AI_CONFIG` で `http://localhost:8001` を指定
- フライト0件
  - まずモック（`FLIGHT_PROVIDER` 未設定）で表示確認
  - OpenSky 利用時は `OPENSKY_USER`/`PASS` を設定（匿名は制限が厳しい）
  - 半径を広げる（例: 50km）、プリセットは HND/NRT/KIX を推奨
- Mixed Content ブロック
  - ページが HTTPS で Proxy が HTTP の場合に発生。Proxy 側も HTTPS（トンネル等）にするか、ページを HTTP（方法A）でアクセス

## 5) チェックリスト
- [ ] Web が `http(s)://<ホスト>:8080` で配信されている
- [ ] Proxy が `http(s)://<ホスト>:8000` で到達可能
- [ ] 右上バッジに flights 件数が表示される
- [ ] プリセット→移動→取得でマーカー表示
- [ ] Quest ではレティクル表示→原点設置→マーカー表示

## 6) 主要コマンド（抜粋）
```
npm run proxy
npm run web
# 任意: ポートを変える
$env:PORT = 8001; npm run proxy
# Cloudflare Tunnel（例）
cloudflared tunnel --url http://localhost:8080
cloudflared tunnel --url http://localhost:8000
```

