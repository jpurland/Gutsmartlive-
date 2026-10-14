// Assembles pages/*.html into public/ with the shared header and footer.
// Page files start with a front-matter block:
// <!--
// title: Page title
// description: One sentence for search results
// nav: research
// -->
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = join(root, "pages");
const outDir = join(root, "public");
const header = readFileSync(join(root, "partials/header.html"), "utf8");
const footer = readFileSync(join(root, "partials/footer.html"), "utf8");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
  });
}

const NAV = ["guide", "research", "articles", "stories"];
let count = 0;

for (const file of walk(pagesDir)) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^<!--\n([\s\S]*?)\n-->\n/);
  if (!m) throw new Error(`Missing front matter in ${file}`);
  const meta = Object.fromEntries(
    m[1].split("\n").map((l) => l.split(/:\s*(.*)/s).slice(0, 2).map((x) => x.trim()))
  );
  const body = raw.slice(m[0].length);
  const rel = relative(pagesDir, file);
  const path = "/" + rel.replace(/index\.html$/, "").replace(/\.html$/, "");

  let head = header
    .replaceAll("{{title}}", meta.title === "Gut Smart Live" ? "Gut Smart Live — living foods and visceral fat" : `${meta.title} | Gut Smart Live`)
    .replaceAll("{{description}}", meta.description || "")
    .replaceAll("{{path}}", path);
  for (const n of NAV) {
    head = head.replace(`data-nav="${n}"`, meta.nav === n ? `data-nav="${n}" aria-current="page"` : `data-nav="${n}"`);
  }

  const out = join(outDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, head + body + footer);
  count++;
}
console.log(`Built ${count} pages`);
