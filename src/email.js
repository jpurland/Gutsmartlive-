// Email through Resend. Every function is a no-op until a Resend API key is saved
// in the settings table, so the site works before email is switched on.

import { escapeHtml } from "./util.js";

const RESEND = "https://api.resend.com";

async function setting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

async function resend(env, path, body) {
  const key = await setting(env, "resend_api_key");
  if (!key) return null;
  const res = await fetch(`${RESEND}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("Resend error", path, res.status, await res.text());
    return null;
  }
  return res.json();
}

export async function addResendContact(env, email, name) {
  const segment = await setting(env, "resend_segment_id");
  const body = { email, first_name: name || undefined, unsubscribed: false };
  if (segment) body.segments = [{ id: segment }];
  return resend(env, "/contacts", body);
}

export async function notifyAdmin(env, subject, line) {
  const to = await setting(env, "admin_email");
  if (!to) return null;
  return resend(env, "/emails", {
    from: env.FROM_EMAIL,
    to: [to],
    subject: `Gut Smart Live: ${subject}`,
    html: `<p>${escapeHtml(line)}</p><p><a href="${env.SITE_URL}/admin">Open the review queue</a></p>`,
  });
}

export async function unsubscribeToken(env, email) {
  let secret = await setting(env, "unsub_secret");
  if (!secret) {
    secret = crypto.randomUUID() + crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('unsub_secret', ?)").bind(secret).run();
    secret = await setting(env, "unsub_secret");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sendWeeklyDigest(env) {
  if (!(await setting(env, "resend_api_key"))) return { skipped: "email not configured" };

  const studies = await env.DB.prepare(
    "SELECT title, journal, pub_date, url FROM research WHERE added_at >= datetime('now', '-7 days') ORDER BY added_at DESC LIMIT 12"
  ).all();
  const stories = await env.DB.prepare(
    "SELECT id, title, name FROM stories WHERE status = 'approved' AND reviewed_at >= datetime('now', '-7 days') ORDER BY reviewed_at DESC LIMIT 5"
  ).all();
  if (!studies.results.length && !stories.results.length) return { skipped: "nothing new this week" };

  const subs = await env.DB.prepare("SELECT email, name FROM subscribers WHERE status = 'active'").all();
  let sent = 0;
  for (let i = 0; i < subs.results.length; i += 100) {
    const batch = [];
    for (const sub of subs.results.slice(i, i + 100)) {
      const token = await unsubscribeToken(env, sub.email);
      const unsub = `${env.SITE_URL}/api/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${token}`;
      batch.push({
        from: env.FROM_EMAIL,
        to: [sub.email],
        subject: "This week in living-diet research",
        html: digestHtml(env, studies.results, stories.results, sub.name, unsub),
        headers: { "List-Unsubscribe": `<${unsub}>` },
      });
    }
    const res = await resend(env, "/emails/batch", batch);
    if (res) sent += batch.length;
  }
  return { sent };
}

export function digestHtml(env, studies, stories, name, unsubUrl) {
  const hello = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const studyItems = studies.map((s) =>
    `<li style="margin:0 0 10px"><a href="${s.url}" style="color:#2f6b4f">${escapeHtml(s.title)}</a><br><span style="color:#5e6863;font-size:13px">${escapeHtml(s.journal)}${s.pub_date ? ", " + escapeHtml(s.pub_date) : ""}</span></li>`
  ).join("");
  const storyItems = stories.map((s) =>
    `<li style="margin:0 0 8px"><a href="${env.SITE_URL}/story?id=${s.id}" style="color:#2f6b4f">${escapeHtml(s.title)}</a> <span style="color:#5e6863">by ${escapeHtml(s.name)}</span></li>`
  ).join("");
  return `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#1f2623;max-width:560px">
<p>${hello}</p>
<p>Here's what's new on Gut Smart Live this week.</p>
${studyItems ? `<h2 style="font-family:Arial,sans-serif;font-size:17px;margin:20px 0 8px">New research</h2><ul style="padding-left:18px">${studyItems}</ul>` : ""}
${storyItems ? `<h2 style="font-family:Arial,sans-serif;font-size:17px;margin:20px 0 8px">New member stories</h2><ul style="padding-left:18px">${storyItems}</ul>` : ""}
<p style="font-size:13px;color:#5e6863;margin-top:24px">Educational information only, not medical advice. Talk with your doctor before changing your diet.<br>
<a href="${unsubUrl}" style="color:#5e6863">Unsubscribe</a></p></div>`;
}
