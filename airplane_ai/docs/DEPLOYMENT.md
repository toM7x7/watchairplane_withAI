# デプロイメモ（PoC用 / GCP）

目的: デモのタイミングで任意のURLにアクセスして手軽に試せるようにする。

## 推奨オプション（複数案）

1) Cloud Storage + Cloud CDN（静的配信） + Cloud Run（API）
- Web: `web/` をGCSに配置し、Cloud CDNを有効化。
- API: `services/flight-proxy` と `services/tts` を別々のCloud Runサービスに。
- ドメイン: Cloud Runドメインマッピング or Cloud Load Balancing経由で `api.example.com`/`tts.example.com` を割り当て。
- フロント設定: `web/index.html` で `window.AI_CONFIG = { FLIGHT_PROXY: 'https://api.example.com', TTS_API: 'https://tts.example.com' }` を埋め込み。

2) Firebase Hosting（静的） + Cloud Run（API）
- Web: Firebase Hostingで `web/` を配信（HTTPS/ドメイン設定が簡易）。
- API: 同上（Cloud Run）。
- Hostingのrewriteで `/api/*` を Cloud Run にプロキシする構成も可。

3) Cloud Run（単一サービス・オールインワン）
- Node/Expressに静的配信を同梱し、`/` で `web/`、`/flights`/`/chat` を同プロセスで提供。
- メリット: デプロイが最も簡素。デメリット: スケール/責務分離/キャッシュが弱い。

4) Cloud Run x2 + Cloud Load Balancing
- `flight-proxy` と `tts` を独立スケール。外部HTTP(S)負荷分散で一つのドメイン配下にパス分割（`/api`, `/tts`）。
- 大規模化・将来のリージョン分散を見据える場合に有効。

5) Cloud Run + API Gateway
- Cloud Runの前段にAPI Gatewayを置き、レート制限やキー認証、CORSポリシーを集中管理。

いずれの構成でも公開時はCORSをオリジン限定へ変更してください。

## 参考コマンド（抜粋）

Cloud Run（Node: flight-proxy）
```
gcloud run deploy flight-proxy \
  --source=services/flight-proxy \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars=FLIGHT_PROVIDER=opensky,GEMINI_API_KEY=__REDACTED__ \
  --update-env-vars=OPENSKY_USER=__REDACTED__,OPENSKY_PASS=__REDACTED__,CACHE_TTL_MS=5000
```

Cloud Run（Python: tts）
```
gcloud run deploy tts \
  --source=services/tts \
  --region=us-central1 \
  --allow-unauthenticated
```

Cloud Storage（web静的）
```
PROJECT=$(gcloud config get-value project)
BUCKET=gs://$PROJECT-web
gcloud storage buckets create $BUCKET --location=US --uniform-bucket-level-access
gcloud storage cp -r web/* $BUCKET
# CDN/HTTPSは Cloud CDN + LB もしくは Firebase Hosting を検討
```

Firebase Hosting（代替）
```
firebase init hosting
# public を web/ に設定、デプロイ前に AI_CONFIG を反映
firebase deploy --only hosting
```

## ベストプラクティス
- 環境変数は Cloud Run サービスのEnvVarsに設定しSecrets Managerと連携。
- OpenSky匿名はレート制限あり。ユーザー名/パスワードの設定を推奨。
- WebXRはHTTPSが必須（`localhost`除く）。公開環境は必ずHTTPS化。
- 静的配信の `Content-Type` に注意（`.js`は`application/javascript`）。

## TODO
- Dockerfileサンプルの追加（Node/Python）
- Cloud Buildトリガ（main push → Cloud Runデプロイ → GCS更新）
- Terraformスニペット（Storage/Run/LB/Domain/CDN）
