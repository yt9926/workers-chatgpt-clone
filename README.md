# Workers Chat (ChatGPT風チャットアプリ)

Cloudflare **Workers AI** と **D1 Database** だけで動く、ログイン不要のChatGPT風チャットアプリです。

- ログイン機能なし。ブラウザごとに `localStorage` のセッションIDで会話履歴を区別します。
- 会話履歴は Cloudflare D1 に保存され、ページを再読み込みしても復元されます。
- AIの応答生成には Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) を使用しています。

## 構成

```
.
├── public/index.html   # チャットUI（静的アセット）
├── src/index.ts         # Worker本体（/api/chat, /api/history）
├── migrations/0001_init.sql  # D1のスキーマ
└── wrangler.toml         # Workers/AI/D1 のバインディング設定
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Cloudflareにログイン

```bash
npx wrangler login
```

### 3. D1データベースの作成（初回のみ）

このリポジトリの `wrangler.toml` は既に作成済みのD1データベース（`workers-chatgpt-clone-db`）を参照しています。
自分のCloudflareアカウントで新しく作り直す場合は以下を実行し、出力された `database_id` を `wrangler.toml` に反映してください。

```bash
npx wrangler d1 create workers-chatgpt-clone-db
```

### 4. スキーマの適用

```bash
# ローカル開発用
npm run db:migrate:local

# 本番用
npm run db:migrate:remote
```

### 5. ローカル起動

```bash
npm run dev
```

### 6. デプロイ

```bash
npm run deploy
```

デプロイ後に表示されるURL（例: `https://workers-chatgpt-clone.<your-subdomain>.workers.dev`）にアクセスするとチャットが使えます。

## GitHub連携で自動デプロイする場合

Cloudflareダッシュボード → Workers & Pages → 「Import a repository（Gitに接続）」からこのリポジトリを選択すると、
`git push` するたびに自動でビルド・デプロイされます。その場合、Cloudflareダッシュボード側で
このリポジトリに対応する D1・Workers AI のバインディングを設定してください（`wrangler.toml` の内容が引き継がれます）。

## 使用しているAPI

- `POST /api/chat` — `{ session_id, message }` を受け取り、Workers AIで応答を生成してD1に保存し、`{ reply }` を返す
- `GET /api/history?session_id=...` — そのセッションの会話履歴を返す
- `DELETE /api/history?session_id=...` — そのセッションの会話履歴を削除する（「新しい会話」ボタン）

## 注意事項

- これはOpenAIのChatGPTそのものではなく、Cloudflare Workers AI上のオープンソースLLM（Llama 3.3 70B）を利用したチャットアプリです。
- ログイン機能がないため、履歴はブラウザ（localStorageのセッションID）単位で分かれます。ブラウザやデバイスを変えると別の会話として扱われます。

