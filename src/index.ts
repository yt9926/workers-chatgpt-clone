export interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS: Fetcher;
}

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT =
  "あなたは親切で有能なAIアシスタントです。日本語で聞かれたら日本語で、英語で聞かれたら英語で、簡潔かつ分かりやすく回答してください。";
const MAX_HISTORY_MESSAGES = 20; // AIに渡す直近の履歴件数（多すぎるとコンテキストが肥大化するため制限）

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function isValidSessionId(sessionId: unknown): sessionId is string {
  return (
    typeof sessionId === "string" &&
    sessionId.length > 0 &&
    sessionId.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(sessionId)
  );
}

async function handleGetHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!isValidSessionId(sessionId)) {
    return jsonResponse({ error: "session_id が不正です" }, { status: 400 });
  }

  const { results } = await env.DB.prepare(
    "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC"
  )
    .bind(sessionId)
    .all();

  return jsonResponse({ messages: results });
}

async function handleDeleteHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!isValidSessionId(sessionId)) {
    return jsonResponse({ error: "session_id が不正です" }, { status: 400 });
  }

  await env.DB.prepare("DELETE FROM messages WHERE session_id = ?").bind(sessionId).run();

  return jsonResponse({ ok: true });
}

async function handlePostChat(request: Request, env: Env): Promise<Response> {
  let body: { session_id?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正なJSONです" }, { status: 400 });
  }

  const { session_id: sessionId, message } = body;

  if (!isValidSessionId(sessionId)) {
    return jsonResponse({ error: "session_id が不正です" }, { status: 400 });
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return jsonResponse({ error: "message は空でないテキストを指定してください" }, { status: 400 });
  }
  if (message.length > 4000) {
    return jsonResponse({ error: "message が長すぎます（4000文字以内）" }, { status: 400 });
  }

  // 直近の履歴を取得してAIに渡すコンテキストを組み立てる
  const { results: historyRows } = await env.DB.prepare(
    "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  )
    .bind(sessionId, MAX_HISTORY_MESSAGES)
    .all<{ role: "user" | "assistant"; content: string }>();

  const history = [...historyRows].reverse();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((row) => ({ role: row.role, content: row.content })),
    { role: "user", content: message },
  ];

  // ユーザーの発言を先に保存
  await env.DB.prepare(
    "INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)"
  )
    .bind(sessionId, message)
    .run();

  let aiReply: string;
  try {
    const aiResponse = (await env.AI.run(MODEL, {
      messages,
      max_tokens: 1024,
    })) as { response?: string };

    aiReply = aiResponse.response?.trim() || "すみません、応答を生成できませんでした。";
  } catch (err) {
    console.error("Workers AI error", err);
    return jsonResponse(
      { error: "AIの応答生成に失敗しました。しばらくしてから再度お試しください。" },
      { status: 502 }
    );
  }

  // AIの返答を保存
  await env.DB.prepare(
    "INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)"
  )
    .bind(sessionId, aiReply)
    .run();

  return jsonResponse({ reply: aiReply });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handlePostChat(request, env);
    }
    if (url.pathname === "/api/history" && request.method === "GET") {
      return handleGetHistory(request, env);
    }
    if (url.pathname === "/api/history" && request.method === "DELETE") {
      return handleDeleteHistory(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not Found" }, { status: 404 });
    }

    // それ以外は静的アセット（チャットUI）を返す
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

