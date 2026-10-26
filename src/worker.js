// Gut Smart Live — Cloudflare Worker
// Serves the static site, the JSON API, the moderation tools, and the scheduled jobs.

import { runResearchFetch } from "./research.js";
import { expandQuery } from "./search.js";
import { sendWeeklyDigest, notifyAdmin, addResendContact, unsubscribeToken } from "./email.js";
import { escapeHtml, clean, isEmail, sha256Hex, canonicalRedirect } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // gutsmartlive.org and www.* all forward to gutsmartlive.com
    const target = canonicalRedirect(url);
    if (target) return Response.redirect(target, 301);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, ctx, url);
      }
    } catch (err) {
      console.error("API error", err);
      return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
    }

    const res = await env.ASSETS.fetch(request);
    return withSecurityHeaders(res);
  },

  async scheduled(event, env, ctx) {
    if (event.cron === "0 13 * * 1") {
      ctx.waitUntil(sendWeeklyDigest(env));
    } else {
      ctx.waitUntil(runResearchFetch(env));
    }
  },
};

// ---------- API ----------

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/api/research" && method === "GET") return listResearch(env, url);
  if (path === "/api/research/log" && method === "GET") return researchLog(env);
  if (path === "/api/subscribe" && method === "POST") return subscribe(request, env, ctx);
  if (path === "/api/unsubscribe" && method === "GET") return unsubscribe(env, url);
  if (path === "/api/stories" && method === "GET") return listStories(env, url);
  if (path === "/api/stories" && method === "POST") return submitStory(request, env, ctx);

  let m = path.match(/^\/api\/stories\/(\d+)$/);
  if (m && method === "GET") return getStory(env, Number(m[1]));
  m = path.match(/^\/api\/stories\/(\d+)\/comments$/);
  if (m && method === "POST") return submitComment(request, env, ctx, Number(m[1]));

  if (path.startsWith("/api/admin/")) return handleAdmin(request, env, ctx, path, method);

  return json({ error: "Not found" }, 404);
}

async function listResearch(env, url) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
  const offset = clampInt(url.searchParams.get("offset"), 0, 100000, 0);
  const topic = (url.searchParams.get("topic") || "").trim();
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);

  const where = [];
  const params = [];
  if (topic) { where.push("topic = ?"); params.push(topic); }
  if (q) {
    // Match any expanded term ("weight issue" -> weight, obes, adipos, visceral, ...).
    const terms = expandQuery(q);
    if (terms.length) {
      where.push(`(${terms.map(() => "lower(title) LIKE ? OR lower(journal) LIKE ?").join(" OR ")})`);
      for (const t of terms) params.push(`%${t}%`, `%${t}%`);
    } else {
      where.push("0");
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT pmid, title, journal, pub_date, authors, topic, url, added_at FROM research ${whereSql}
     ORDER BY added_at DESC, pub_date DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM research ${whereSql}`).bind(...params).first();
  return json({ items: rows.results, total: total.n }, 200, { "cache-control": "public, max-age=300" });
}

async function researchLog(env) {
  const rows = await env.DB.prepare(
    "SELECT ran_at, found, added, error FROM fetch_log ORDER BY id DESC LIMIT 10"
  ).all();
  return json({ runs: rows.results });
}

async function subscribe(request, env, ctx) {
  const body = await readBody(request);
  if (body.website) return json({ ok: true }); // honeypot
  const email = String(body.email || "").trim().toLowerCase();
  const name = clean(body.name, 80);
  if (!isEmail(email)) return json({ error: "Enter a valid email address." }, 400);

  await env.DB.prepare(
    `INSERT INTO subscribers (email, name, status) VALUES (?, ?, 'active')
     ON CONFLICT(email) DO UPDATE SET status = 'active', name = COALESCE(excluded.name, subscribers.name)`
  ).bind(email, name || null).run();
  ctx.waitUntil(addResendContact(env, email, name));
  return json({ ok: true, message: "You're on the list. The first digest arrives next Monday." });
}

async function unsubscribe(env, url) {
  const email = String(url.searchParams.get("email") || "").toLowerCase();
  const token = String(url.searchParams.get("token") || "");
  const expected = await unsubscribeToken(env, email);
  if (!email || !expected || token !== expected) {
    return html(page("Unsubscribe", "<p>That unsubscribe link isn't valid. Reply to any digest email and we'll remove you by hand.</p>"), 400);
  }
  await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE email = ?").bind(email).run();
  return html(page("Unsubscribed", `<p>${escapeHtml(email)} won't get the weekly digest anymore.</p><p><a href="/">Back to Gut Smart Live</a></p>`));
}

async function listStories(env, url) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
  const offset = clampInt(url.searchParams.get("offset"), 0, 100000, 0);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.name, s.title, substr(s.body, 1, 320) AS excerpt, s.outcome, s.created_at,
       (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id AND c.status = 'approved') AS comment_count
     FROM stories s WHERE s.status = 'approved' ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return json({ items: rows.results });
}

async function getStory(env, id) {
  const story = await env.DB.prepare(
    "SELECT id, name, title, body, outcome, created_at FROM stories WHERE id = ? AND status = 'approved'"
  ).bind(id).first();
  if (!story) return json({ error: "That story isn't available." }, 404);
  const comments = await env.DB.prepare(
    "SELECT id, name, body, created_at FROM comments WHERE story_id = ? AND status = 'approved' ORDER BY created_at ASC"
  ).bind(id).all();
  return json({ story, comments: comments.results });
}

const OUTCOMES = new Set(["worked", "mixed", "didnt"]);

async function submitStory(request, env, ctx) {
  const body = await readBody(request);
  if (body.website) return json({ ok: true }); // honeypot
  const name = clean(body.name, 60);
  const title = clean(body.title, 120);
  const story = clean(body.body, 5000, true);
  const email = String(body.email || "").trim().toLowerCase();
  const outcome = OUTCOMES.has(body.outcome) ? body.outcome : "mixed";

  if (!name) return json({ error: "Add a first name or nickname." }, 400);
  if (title.length < 4) return json({ error: "Give your story a short title." }, 400);
  if (story.length < 80) return json({ error: "Tell us a little more — at least a few sentences." }, 400);
  if (email && !isEmail(email)) return json({ error: "That email address doesn't look right." }, 400);

  const res = await env.DB.prepare(
    "INSERT INTO stories (name, email, title, body, outcome) VALUES (?, ?, ?, ?, ?)"
  ).bind(name, email || null, title, story, outcome).run();
  ctx.waitUntil(notifyAdmin(env, "New story waiting for approval", `"${title}" by ${name}`));
  return json({ ok: true, id: res.meta.last_row_id, message: "Thanks for sharing. Your story will appear once it's reviewed, usually within a day." });
}

async function submitComment(request, env, ctx, storyId) {
  const body = await readBody(request);
  if (body.website) return json({ ok: true });
  const story = await env.DB.prepare("SELECT id, title FROM stories WHERE id = ? AND status = 'approved'").bind(storyId).first();
  if (!story) return json({ error: "That story isn't available." }, 404);
  const name = clean(body.name, 60);
  const text = clean(body.body, 2000, true);
  if (!name) return json({ error: "Add a first name or nickname." }, 400);
  if (text.length < 10) return json({ error: "Write a little more before posting." }, 400);
  await env.DB.prepare("INSERT INTO comments (story_id, name, body) VALUES (?, ?, ?)").bind(storyId, name, text).run();
  ctx.waitUntil(notifyAdmin(env, "New comment waiting for approval", `${name} on "${story.title}"`));
  return json({ ok: true, message: "Thanks. Your comment will appear once it's reviewed." });
}

// ---------- Admin ----------

async function handleAdmin(request, env, ctx, path, method) {
  if (!(await isAdmin(request, env))) {
    return json({ error: "Wrong password." }, 401);
  }

  if (path === "/api/admin/check") return json({ ok: true });

  if (path === "/api/admin/queue" && method === "GET") {
    const stories = await env.DB.prepare(
      "SELECT id, name, email, title, body, outcome, created_at FROM stories WHERE status = 'pending' ORDER BY created_at ASC"
    ).all();
    const comments = await env.DB.prepare(
      `SELECT c.id, c.name, c.body, c.created_at, s.title AS story_title FROM comments c
       JOIN stories s ON s.id = c.story_id WHERE c.status = 'pending' ORDER BY c.created_at ASC`
    ).all();
    const subs = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE status = 'active'").first();
    const research = await env.DB.prepare("SELECT COUNT(*) AS n FROM research").first();
    const lastRun = await env.DB.prepare("SELECT ran_at, found, added, error FROM fetch_log ORDER BY id DESC LIMIT 1").first();
    return json({ stories: stories.results, comments: comments.results, subscribers: subs.n, research: research.n, lastRun });
  }

  const m = path.match(/^\/api\/admin\/(stories|comments)\/(\d+)\/(approve|reject)$/);
  if (m && method === "POST") {
    const table = m[1] === "stories" ? "stories" : "comments";
    const status = m[3] === "approve" ? "approved" : "rejected";
    const extra = table === "stories" ? ", reviewed_at = datetime('now')" : "";
    await env.DB.prepare(`UPDATE ${table} SET status = ?${extra} WHERE id = ?`).bind(status, Number(m[2])).run();
    return json({ ok: true, status });
  }

  if (path === "/api/admin/fetch-research" && method === "POST") {
    const result = await runResearchFetch(env);
    return json({ ok: true, ...result });
  }

  return json({ error: "Not found" }, 404);
}

async function isAdmin(request, env) {
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return false;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_password_sha256'").first();
  if (!row) return false;
  const hash = await sha256Hex(supplied);
  return timingSafeEqual(hash, row.value);
}

// ---------- helpers ----------


function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) return (await request.json()) || {};
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  } catch {
    return {};
  }
}



function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}


function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Gut Smart Live</title><link rel="stylesheet" href="/css/site.css"></head>
<body><main class="wrap narrow simple-page"><h1>${escapeHtml(title)}</h1>${inner}</main></body></html>`;
}

function withSecurityHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  out.headers.set("x-frame-options", "SAMEORIGIN");
  return out;
}
