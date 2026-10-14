import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSummaries } from "../src/research.js";
import { clean, isEmail, escapeHtml, sha256Hex, canonicalRedirect } from "../src/util.js";
import { digestHtml } from "../src/email.js";

test("parseSummaries turns PubMed esummary JSON into rows", () => {
  const data = {
    result: {
      uids: ["111", "222"],
      111: {
        title: "Kefir and <i>visceral</i> fat: a trial.",
        fulljournalname: "Nutrients",
        pubdate: "2026 Oct",
        authors: [{ name: "Smith J" }, { name: "Lee K" }, { name: "Ng P" }, { name: "Ortiz R" }],
      },
      222: { title: "", source: "Gut" },
    },
  };
  const rows = parseSummaries(data);
  assert.equal(rows.length, 1, "entries without a title are dropped");
  assert.deepEqual(rows[0], {
    pmid: "111",
    title: "Kefir and visceral fat: a trial",
    journal: "Nutrients",
    pub_date: "2026 Oct",
    authors: "Smith J, Lee K, Ng P et al.",
    url: "https://pubmed.ncbi.nlm.nih.gov/111/",
  });
});

test("parseSummaries tolerates empty responses", () => {
  assert.deepEqual(parseSummaries({}), []);
  assert.deepEqual(parseSummaries(null), []);
});

test("clean trims, collapses whitespace and caps length", () => {
  assert.equal(clean("  a   b \n c ", 100), "a b c");
  assert.equal(clean("line one\r\n\r\n\r\n\r\nline   two", 100, true), "line one\n\nline two");
  assert.equal(clean("abcdef", 3), "abc");
  assert.equal(clean(undefined, 10), "");
});

test("isEmail accepts real addresses and rejects junk", () => {
  assert.ok(isEmail("jp@gutsmartlive.com"));
  assert.ok(!isEmail("jp@local"));
  assert.ok(!isEmail("not an email"));
  assert.ok(!isEmail(""));
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
});

test("sha256Hex matches a known digest", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("digest email escapes content and includes the unsubscribe link", () => {
  const out = digestHtml(
    { SITE_URL: "https://gutsmartlive.com" },
    [{ title: "<b>Study</b>", journal: "Gut", pub_date: "2026", url: "https://pubmed.ncbi.nlm.nih.gov/1/" }],
    [{ id: 4, title: "My story", name: "Ann" }],
    "Ann",
    "https://gutsmartlive.com/api/unsubscribe?x=1"
  );
  assert.ok(out.includes("&lt;b&gt;Study&lt;/b&gt;"));
  assert.ok(out.includes("/story?id=4"));
  assert.ok(out.includes("api/unsubscribe?x=1"));
  assert.ok(out.includes("Hi Ann,"));
});

// The local dev server rewrites every request to localhost, so the domain redirect is
// checked here directly and again against the live domains after deploy.
test("other gutsmartlive domains redirect to gutsmartlive.com", () => {
  assert.equal(canonicalRedirect("https://gutsmartlive.org/research?x=1"), "https://gutsmartlive.com/research?x=1");
  assert.equal(canonicalRedirect("http://www.gutsmartlive.org/"), "https://gutsmartlive.com/");
  assert.equal(canonicalRedirect("https://www.gutsmartlive.com/stories"), "https://gutsmartlive.com/stories");
  assert.equal(canonicalRedirect("https://gutsmartlive.com/"), null);
  assert.equal(canonicalRedirect("http://localhost:8787/"), null);
  assert.equal(canonicalRedirect("https://gutsmartlive.workers.dev/"), null);
});
