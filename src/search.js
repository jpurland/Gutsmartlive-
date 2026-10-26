// Turns a reader's plain-English search ("weight issue", "losing belly fat") into
// the terms that actually appear in study titles.

const STOP = new Set(
  ("a an and are about any as at be best can do does for from get getting gut have help how i in is issue issues it " +
    "me my of on or problem problems should the this to trouble what when with your study studies research").split(" ")
);

// Reader word (or its stem) -> title fragments to look for.
const SYNONYMS = {
  weight: ["weight", "obesity", "obese", "overweight", "adipos", "visceral", "body fat", "fat mass", "waist", "bmi"],
  obes: ["obesity", "obese", "overweight", "adipos", "weight", "bmi"],
  fat: ["fat", "adipos", "visceral", "obesity", "obese", "lipid"],
  belly: ["visceral", "abdominal", "waist", "belly"],
  visceral: ["visceral", "abdominal", "adipos"],
  bmi: ["bmi", "body mass", "obesity", "obese"],
  sugar: ["glucose", "glyc", "insulin", "diabet", "sugar"],
  diabet: ["diabet", "glucose", "insulin", "glyc"],
  insulin: ["insulin", "glucose", "diabet"],
  liver: ["liver", "hepat", "nafld", "masld"],
  heart: ["cardio", "heart", "cholesterol", "lipid", "blood pressure"],
  cholesterol: ["cholesterol", "lipid", "ldl"],
  inflam: ["inflamm", "crp", "cytokine"],
  mood: ["mood", "depress", "anxiety"],
  depress: ["depress", "mood"],
  anxiety: ["anxiety", "stress"],
  microbiome: ["microbio", "bacteria", "flora"],
  flora: ["microbio", "flora", "bacteria"],
  bacteria: ["bacteria", "microbio", "probiotic"],
  probiotic: ["probiotic", "lactobac", "bifido"],
  ferment: ["ferment", "kefir", "kimchi", "sauerkraut", "yogurt", "yoghurt", "kombucha", "miso"],
  yogurt: ["yogurt", "yoghurt", "fermented dairy"],
  digest: ["digest", "bowel", "ibs", "bloat"],
  bloat: ["bloat", "ibs", "bowel"],
};

export function stem(word) {
  let w = word.toLowerCase();
  for (const suffix of ["ities", "ity", "ing", "ies", "es", "ed", "ic", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

/** Meaningful search words: lowercased, filler words removed. */
export function searchWords(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Title fragments to OR together for a query, capped to keep the SQL small. */
export function expandQuery(q, max = 16) {
  const terms = new Set();
  for (const word of searchWords(q)) {
    const s = stem(word);
    const key = Object.keys(SYNONYMS).find((k) => s.startsWith(k) || k.startsWith(s));
    if (key) for (const t of SYNONYMS[key]) terms.add(t);
    else terms.add(s);
  }
  return [...terms].slice(0, max);
}
