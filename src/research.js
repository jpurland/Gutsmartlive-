// Pulls recent studies from PubMed (NCBI E-utilities) and logs them in D1.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export const TOPICS = [
  {
    id: "visceral-fat",
    label: "Probiotics & visceral fat",
    query: '(probiotic*[tiab] OR "fermented food*"[tiab] OR kefir[tiab] OR lactobacillus[tiab]) AND ("visceral fat"[tiab] OR "visceral adipose"[tiab] OR "abdominal fat"[tiab] OR "waist circumference"[tiab])',
  },
  {
    id: "fermented-foods",
    label: "Fermented foods & the gut",
    query: '("fermented food*"[tiab] OR "fermented dairy"[tiab] OR kimchi[tiab] OR sauerkraut[tiab] OR kefir[tiab]) AND (microbiome[tiab] OR microbiota[tiab] OR inflammation[tiab])',
  },
  {
    id: "visceral-imaging",
    label: "Measuring visceral fat",
    query: '("visceral adipose tissue"[tiab] OR "visceral fat"[tiab]) AND (MRI[tiab] OR "magnetic resonance"[tiab]) AND (diet[tiab] OR dietary[tiab] OR nutrition[tiab])',
  },
];

export async function runResearchFetch(env, { perTopic = 15 } = {}) {
  let found = 0;
  let added = 0;
  const errors = [];

  for (const topic of TOPICS) {
    try {
      const ids = await search(topic.query, perTopic);
      found += ids.length;
      if (!ids.length) continue;
      const summaries = await summarize(ids);
      for (const s of summaries) {
        const res = await env.DB.prepare(
          `INSERT OR IGNORE INTO research (pmid, title, journal, pub_date, authors, topic, url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(s.pmid, s.title, s.journal, s.pub_date, s.authors, topic.id, s.url).run();
        added += res.meta.changes || 0;
      }
    } catch (err) {
      errors.push(`${topic.id}: ${err.message}`);
    }
    await sleep(400); // stay well under PubMed's 3 requests/second limit
  }

  await env.DB.prepare("INSERT INTO fetch_log (found, added, error) VALUES (?, ?, ?)")
    .bind(found, added, errors.length ? errors.join("; ") : null).run();
  return { found, added, errors };
}

async function search(term, retmax) {
  const url = `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&retmax=${retmax}` +
    `&tool=gutsmartlive&term=${encodeURIComponent(term)}`;
  const data = await getJson(url);
  return data?.esearchresult?.idlist || [];
}

async function summarize(ids) {
  await sleep(400);
  const url = `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&tool=gutsmartlive&id=${ids.join(",")}`;
  const data = await getJson(url);
  return parseSummaries(data);
}

export function parseSummaries(data) {
  const result = data?.result;
  if (!result) return [];
  return (result.uids || []).map((uid) => {
    const r = result[uid] || {};
    const authors = (r.authors || []).map((a) => a.name).filter(Boolean);
    const authorText = authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
    return {
      pmid: String(uid),
      title: stripTags(r.title || "").replace(/\.$/, ""),
      journal: r.fulljournalname || r.source || "",
      pub_date: r.pubdate || r.epubdate || "",
      authors: authorText,
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
    };
  }).filter((s) => s.title);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "GutSmartLive/1.0 (+https://gutsmartlive.com)" } });
  if (!res.ok) throw new Error(`PubMed responded ${res.status}`);
  return res.json();
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
