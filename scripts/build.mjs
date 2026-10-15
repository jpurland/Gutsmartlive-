// Assembles pages/*.html into public/ with the shared header and footer.
// Page files start with a front-matter block:
// <!--
// title: Page title
// description: One sentence for search results
// nav: research
// -->
// Condition sections come from content/conditions.json. The build generates
// /conditions/ and one page per condition, fills the <!--conditions-grid-->
// and <!--conditions-articles--> markers, and writes sitemap.xml.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = join(root, "pages");
const outDir = join(root, "public");
const header = readFileSync(join(root, "partials/header.html"), "utf8");
const footer = readFileSync(join(root, "partials/footer.html"), "utf8");
const conditions = JSON.parse(readFileSync(join(root, "content/conditions.json"), "utf8"));

const NAV = ["guide", "conditions", "research", "articles", "stories"];
const EVIDENCE = { strong: "Strong research base", growing: "Growing evidence", early: "Early research" };
const NOINDEX = new Set(["/admin", "/404", "/story"]);

const esc = (s) => String(s).replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
  });
}

// Every article listed in conditions.json must exist, and every condition article file must be listed.
const listed = new Set();
for (const c of conditions) {
  if (!EVIDENCE[c.evidence]) throw new Error(`Unknown evidence level "${c.evidence}" for ${c.slug}`);
  for (const a of c.articles) {
    const f = join(pagesDir, "conditions", c.slug, `${a.slug}.html`);
    if (!existsSync(f)) throw new Error(`conditions.json lists ${c.slug}/${a.slug} but ${relative(root, f)} is missing`);
    listed.add(f);
  }
}
const condDir = join(pagesDir, "conditions");
if (existsSync(condDir)) {
  for (const f of walk(condDir)) {
    if (!listed.has(f)) throw new Error(`${relative(root, f)} is not listed in content/conditions.json`);
  }
}

function conditionsGrid(exclude) {
  const boxes = conditions.filter((c) => c.slug !== exclude).map((c) => {
    const cls = c.featured ? "cond-box featured" : "cond-box";
    const eyebrow = c.featured ? `<span class="cond-eyebrow">Featured section</span>` : "";
    return `<a class="${cls}" href="/conditions/${c.slug}/">${eyebrow}<h3>${esc(c.title)}</h3><p>${esc(c.summary)}</p>` +
      `<span class="cond-meta"><span class="ev ev-${c.evidence}">${EVIDENCE[c.evidence]}</span>${plural(c.articles.length, "article")}</span></a>`;
  });
  return `<div class="cond-grid">\n${boxes.join("\n")}\n</div>`;
}

function articleList(c) {
  return c.articles.map((a, i) =>
    `<a class="story-card numbered" href="/conditions/${c.slug}/${a.slug}"><span class="num">${i + 1}</span><div><h3>${esc(a.title)}</h3><p>${esc(a.blurb)}</p><span class="meta">${a.minutes} minute read</span></div></a>`
  ).join("\n");
}

function conditionsArticles() {
  return conditions.map((c) =>
    `<div class="cond-group"><div class="section-head"><h2>${esc(c.title)}</h2><a href="/conditions/${c.slug}/">Section overview</a></div>\n<div class="article-list">\n${articleList(c)}\n</div></div>`
  ).join("\n");
}

function conditionPage(c) {
  return `<section class="page-head">
  <div class="wrap">
    <a class="breadcrumb" href="/conditions/">All conditions</a>
    <h1>${esc(c.title)}</h1>
    <p class="lede">${esc(c.intro)}</p>
    <p class="cond-meta"><span class="ev ev-${c.evidence}">${EVIDENCE[c.evidence]}</span>${plural(c.articles.length, "article")}</p>
  </div>
</section>
<section class="section" style="padding-top:8px">
  <div class="wrap article-list">
${articleList(c)}
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="callout">These articles explain published research in plain language. They're educational, not medical advice. Don't stop or change any treatment without talking to your doctor.</div>
${conditions.length > 1 ? `    <div class="section-head" style="margin-top:22px"><h2>More conditions</h2><a href="/conditions/">See all</a></div>
    ${conditionsGrid(c.slug)}` : ""}
  </div>
</section>
`;
}

const pages = [];

for (const file of walk(pagesDir)) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^<!--\n([\s\S]*?)\n-->\n/);
  if (!m) throw new Error(`Missing front matter in ${file}`);
  const meta = Object.fromEntries(
    m[1].split("\n").map((l) => l.split(/:\s*(.*)/s).slice(0, 2).map((x) => x.trim()))
  );
  pages.push({ rel: relative(pagesDir, file), meta, body: raw.slice(m[0].length) });
}

pages.push({
  rel: "conditions/index.html",
  meta: {
    title: "Conditions",
    description: "How the gut microbiome is linked to obesity, diabetes, fatty liver, arthritis, heart health, digestion and mood, with research-backed articles for each.",
    nav: "conditions",
  },
  body: `<section class="page-head">
  <div class="wrap">
    <h1>Conditions and your gut</h1>
    <p class="lede">The bacteria in your gut are linked to far more than digestion. Pick a condition to see what the research shows and what you can do about it.</p>
  </div>
</section>
<section class="section" style="padding-top:8px">
  <div class="wrap">
    <!--conditions-grid-->
    <p class="meta" style="margin-top:12px">Evidence labels are our honest read of how strong the human research is that the gut plays a meaningful role. Educational only, not medical advice.</p>
  </div>
</section>
`,
});

for (const c of conditions) {
  pages.push({
    rel: `conditions/${c.slug}/index.html`,
    meta: { title: c.title, description: c.summary, nav: "conditions" },
    body: conditionPage(c),
  });
}

const paths = [];
for (const { rel, meta, body } of pages) {
  const path = "/" + rel.replace(/index\.html$/, "").replace(/\.html$/, "");

  let head = header
    .replaceAll("{{title}}", meta.title === "Gut Smart Live" ? "Gut Smart Live — living foods and visceral fat" : `${meta.title} | Gut Smart Live`)
    .replaceAll("{{description}}", meta.description || "")
    .replaceAll("{{path}}", path);
  for (const n of NAV) {
    head = head.replace(`data-nav="${n}"`, meta.nav === n ? `data-nav="${n}" aria-current="page"` : `data-nav="${n}"`);
  }

  const html = (head + body + footer)
    .replaceAll("<!--conditions-grid-->", conditionsGrid())
    .replaceAll("<!--conditions-articles-->", conditionsArticles());

  const out = join(outDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  if (!NOINDEX.has(path)) paths.push(path);
}

paths.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
writeFileSync(join(outDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  paths.map((p) => `<url><loc>https://gutsmartlive.com${p}</loc></url>`).join("\n") + `\n</urlset>\n`);

console.log(`Built ${pages.length} pages`);
