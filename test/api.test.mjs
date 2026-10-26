// End-to-end API test against a local wrangler dev server with a throwaway database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "test-admin-password";
const state = mkdtempSync(join(tmpdir(), "gsl-"));
const wrangler = join(process.cwd(), "node_modules/.bin/wrangler");
let server;

function sh(args) {
  return execFileSync(wrangler, args, { stdio: "pipe", env: { ...process.env, CI: "1" } }).toString();
}

before(async () => {
  execFileSync("node", ["scripts/build.mjs"], { stdio: "pipe" });
  sh(["d1", "migrations", "apply", "gutsmartlive-db", "--local", "--persist-to", state]);
  const hash = createHash("sha256").update(PASSWORD).digest("hex");
  sh(["d1", "execute", "gutsmartlive-db", "--local", "--persist-to", state, "--command",
    `INSERT INTO settings (key, value) VALUES ('admin_password_sha256', '${hash}');
     INSERT INTO research (pmid, title, journal, pub_date, authors, topic, url) VALUES
     ('900001', 'Kefir and visceral fat in adults', 'Nutrients', '2026 Oct', 'Smith J', 'visceral-fat', 'https://pubmed.ncbi.nlm.nih.gov/900001/'),
     ('900002', 'Kimchi intake and the gut microbiome', 'Gut Microbes', '2026 Sep', 'Lee K', 'fermented-foods', 'https://pubmed.ncbi.nlm.nih.gov/900002/');`]);
  server = spawn(wrangler, ["dev", "--local", "--port", String(PORT), "--persist-to", state, "--test-scheduled"], {
    stdio: "pipe", env: { ...process.env, CI: "1" },
  });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + "/")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler dev did not start");
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(state, { recursive: true, force: true });
});

const post = (path, body, headers = {}) =>
  fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const admin = { authorization: `Bearer ${PASSWORD}` };

test("every page renders with the shared header and footer", async () => {
  for (const p of ["/", "/living-diet", "/research", "/articles/", "/articles/what-the-research-says", "/articles/what-is-visceral-fat", "/stories", "/story?id=1", "/about", "/admin"]) {
    const res = await fetch(BASE + p);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.ok(html.includes('class="site-header"') && html.includes('class="site-footer"'), `${p} has chrome`);
    assert.ok(html.includes("not affiliated with or endorsed by Dr. O'Mara"), `${p} has disclaimer`);
  }
});

test("unknown pages return the 404 page", async () => {
  const res = await fetch(BASE + "/no-such-page");
  assert.equal(res.status, 404);
  assert.ok((await res.text()).includes("That page isn't here"));
});

test("research API lists, filters and searches", async () => {
  let data = await (await fetch(BASE + "/api/research")).json();
  assert.equal(data.total, 2);
  data = await (await fetch(BASE + "/api/research?topic=fermented-foods")).json();
  assert.deepEqual(data.items.map((i) => i.pmid), ["900002"]);
  data = await (await fetch(BASE + "/api/research?q=kefir")).json();
  assert.deepEqual(data.items.map((i) => i.pmid), ["900001"]);
});

test("research search understands plain-English weight questions", async () => {
  let data = await (await fetch(BASE + "/api/research?q=" + encodeURIComponent("weight issue"))).json();
  assert.deepEqual(data.items.map((i) => i.pmid), ["900001"], "visceral-fat study matches 'weight issue'");
  data = await (await fetch(BASE + "/api/research?q=" + encodeURIComponent("gut flora"))).json();
  assert.deepEqual(data.items.map((i) => i.pmid), ["900002"], "'flora' finds microbiome studies");
  data = await (await fetch(BASE + "/api/research?q=issue")).json();
  assert.equal(data.total, 0, "filler words alone match nothing");
});

test("narrow reading pages get side menus; the homepage does not", async () => {
  const diet = await (await fetch(BASE + "/living-diet")).text();
  assert.ok(diet.includes('class="rails-layout"') && diet.includes("data-toc") && diet.includes("data-rail-studies"));
  const home = await (await fetch(BASE + "/")).text();
  assert.ok(!home.includes('class="rails-layout"'));
  const cond = await (await fetch(BASE + "/conditions")).text();
  assert.ok(cond.includes('id="cond-studies"') && cond.includes("weight loss"));
});

test("newsletter signup validates and stores the address", async () => {
  let res = await post("/api/subscribe", { email: "nope" });
  assert.equal(res.status, 400);
  res = await post("/api/subscribe", { email: "Reader@Example.com", name: "Ann" });
  assert.equal(res.status, 200);
  res = await post("/api/subscribe", { email: "reader@example.com" });
  assert.equal(res.status, 200, "re-subscribing is fine");
  const q = await (await fetch(BASE + "/api/admin/queue", { headers: admin })).json();
  assert.equal(q.subscribers, 1);
});

test("stories stay hidden until approved, then appear with approved comments", async () => {
  let res = await post("/api/stories", { name: "Ann", title: "Hi", body: "short" });
  assert.equal(res.status, 400);

  const body = "I added a forkful of sauerkraut to every dinner for twelve weeks and my waist dropped two inches. ".repeat(2);
  res = await post("/api/stories", { name: "Ann", title: "Twelve weeks of sauerkraut", body, outcome: "worked", email: "ann@example.com" });
  assert.equal(res.status, 200);
  const { id } = await res.json();

  let list = await (await fetch(BASE + "/api/stories")).json();
  assert.equal(list.items.length, 0, "pending story is not public");
  assert.equal((await fetch(BASE + `/api/stories/${id}`)).status, 404);

  assert.equal((await post(`/api/admin/stories/${id}/approve`, {})).status, 401, "approval needs the password");
  assert.equal((await post(`/api/admin/stories/${id}/approve`, {}, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await post(`/api/admin/stories/${id}/approve`, {}, admin)).status, 200);

  list = await (await fetch(BASE + "/api/stories")).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].email, undefined, "email is never public");

  res = await post(`/api/stories/${id}/comments`, { name: "Bo", body: "Same experience with kimchi." });
  assert.equal(res.status, 200);
  let detail = await (await fetch(BASE + `/api/stories/${id}`)).json();
  assert.equal(detail.comments.length, 0, "pending comment is hidden");

  const q = await (await fetch(BASE + "/api/admin/queue", { headers: admin })).json();
  assert.equal(q.comments.length, 1);
  await post(`/api/admin/comments/${q.comments[0].id}/approve`, {}, admin);
  detail = await (await fetch(BASE + `/api/stories/${id}`)).json();
  assert.equal(detail.comments.length, 1);
  assert.equal(detail.story.title, "Twelve weeks of sauerkraut");
});

test("rejected stories never appear", async () => {
  const body = "This is a long enough story to pass validation but it should be rejected by the moderator. ".repeat(2);
  const { id } = await (await post("/api/stories", { name: "Spam", title: "Buy my pills", body })).json();
  await post(`/api/admin/stories/${id}/reject`, {}, admin);
  assert.equal((await fetch(BASE + `/api/stories/${id}`)).status, 404);
});

test("honeypot submissions are silently dropped", async () => {
  const body = "Bot text that is long enough to pass every length check in the story form validation. ".repeat(2);
  await post("/api/stories", { name: "Bot", title: "Bot story", body, website: "http://spam" });
  const q = await (await fetch(BASE + "/api/admin/queue", { headers: admin })).json();
  assert.ok(!q.stories.some((s) => s.name === "Bot"));
});

test("unsubscribe rejects bad tokens", async () => {
  const res = await fetch(BASE + "/api/unsubscribe?email=reader@example.com&token=bad");
  assert.equal(res.status, 400);
});
