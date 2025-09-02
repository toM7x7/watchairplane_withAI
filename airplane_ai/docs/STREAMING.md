# ストリーミング更新（SSE）

- エンドポイント: `GET /flights/stream?lat=..&lon=..&radius=..&interval=3000`
- クライアントは `EventSource` で接続し、指定間隔ごとにJSONを受信します。
- Web側はSSEを既定で使用し、非対応時にポーリング（10秒）へフォールバックします。
- 注意: 開発CORSは許容されていますが、公開時はオリジンを制限してください。

