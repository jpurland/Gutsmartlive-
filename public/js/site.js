(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const TOPIC_LABELS = {
    "visceral-fat": "Probiotics & visceral fat",
    "fermented-foods": "Fermented foods & the gut",
    "visceral-imaging": "Measuring visceral fat",
  };
  const OUTCOME_LABELS = { worked: "It worked", mixed: "Mixed results", didnt: "Didn't work for me" };

  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again in a minute.");
    return data;
  }

  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s.replace(" ", "T") + (s.length <= 19 ? "Z" : ""));
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // Mobile menu
  const toggle = $(".menu-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const nav = $("#nav");
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  // ---------- Plate builder ----------
  const PROTEINS = [
    { id: "steak", label: "Steak", name: "Steak" },
    { id: "salmon", label: "Salmon", name: "Salmon" },
    { id: "eggs", label: "Eggs", name: "Eggs" },
    { id: "chicken", label: "Chicken", name: "Roast chicken" },
    { id: "lamb", label: "Lamb", name: "Lamb" },
    { id: "lentils", label: "Lentils", name: "Lentils" },
  ];
  const LIVING = [
    { id: "sauerkraut", label: "Sauerkraut", name: "sauerkraut", tip: "Spoon the sauerkraut on after cooking. Heat kills live cultures, so keep it cold or at room temperature." },
    { id: "kimchi", label: "Kimchi", name: "kimchi", tip: "Add kimchi cold, straight from the jar. Look for brands sold refrigerated; shelf-stable jars are usually pasteurized." },
    { id: "kefir", label: "Kefir", name: "a glass of kefir", tip: "Plain kefir carries more strains than most yogurts. Drink it with the meal rather than on its own." },
    { id: "yogurt", label: "Plain yogurt", name: "plain yogurt", tip: "Choose plain, unsweetened yogurt with \"live and active cultures\" on the label. Use it as a cold sauce." },
    { id: "pickles", label: "Brine pickles", name: "brine-fermented pickles", tip: "Only pickles fermented in salt brine are alive. Vinegar pickles taste similar but carry no cultures." },
    { id: "miso", label: "Miso", name: "a miso dressing", tip: "Stir miso into a dressing or a warm (not boiling) broth so the cultures survive." },
    { id: "cheese", label: "Aged cheese", name: "raw-milk aged cheese", tip: "Aged cheeses like Gouda and cheddar can carry live bacteria, especially raw-milk varieties. Check with your doctor if pregnant." },
  ];

  const plate = $("#plate");
  if (plate) {
    const state = { protein: "steak", living: "sauerkraut" };
    const shades = { protein: ["#2f6b4f", "#3c7d5f", "#285c44", "#4a8a6c", "#234f3b", "#5b8f74"], living: ["#d9a441", "#c9932f", "#e2b55e", "#d39a3a", "#e8c070", "#bf8a2a", "#d6a84c"] };

    const renderChips = (kind, list) => {
      const box = $(`.chips[data-kind="${kind}"]`, plate);
      box.innerHTML = list.map((it) =>
        `<button type="button" class="chip${kind === "living" ? " living" : ""}" data-id="${it.id}" aria-pressed="${state[kind] === it.id}">${esc(it.label)}</button>`
      ).join("");
      box.addEventListener("click", (e) => {
        const btn = e.target.closest(".chip");
        if (!btn) return;
        state[kind] = btn.dataset.id;
        $$(".chip", box).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        update();
      });
    };

    const update = () => {
      const p = PROTEINS.find((x) => x.id === state.protein);
      const l = LIVING.find((x) => x.id === state.living);
      $("#plate-name").textContent = `${p.name} with ${l.name}`;
      $("#plate-tip").textContent = l.tip;
      $("#seg-protein").setAttribute("fill", shades.protein[PROTEINS.indexOf(p) % shades.protein.length]);
      $("#seg-living").setAttribute("fill", shades.living[LIVING.indexOf(l) % shades.living.length]);
    };

    renderChips("protein", PROTEINS);
    renderChips("living", LIVING);
    update();
  }

  // ---------- Research ----------
  const studyItem = (s) => `<li>
    <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
    <span class="meta"><span class="tag">${esc(TOPIC_LABELS[s.topic] || "Research")}</span>${esc(s.journal)}${s.pub_date ? ", " + esc(s.pub_date) : ""}${s.authors ? " · " + esc(s.authors) : ""}</span>
  </li>`;

  $$("[data-research-list]").forEach(async (list) => {
    if (list.hasAttribute("data-research-page")) return;
    try {
      const { items } = await api(`/api/research?limit=${list.dataset.limit || 5}`);
      list.innerHTML = items.length ? items.map(studyItem).join("") : `<li class="meta">The first research pull runs tonight. Check back tomorrow.</li>`;
    } catch (err) {
      list.innerHTML = `<li class="meta">${esc(err.message)}</li>`;
    }
  });

  const researchPage = $("[data-research-page]");
  if (researchPage) {
    const form = $("#research-filters");
    const more = $("#research-more");
    const count = $("#research-count");
    let offset = 0;
    const PAGE = 20;

    const load = async (reset) => {
      if (reset) { offset = 0; researchPage.innerHTML = `<li class="meta">Loading…</li>`; }
      const q = form.q.value.trim();
      const topic = form.topic.value;
      const params = new URLSearchParams({ limit: PAGE, offset });
      if (q) params.set("q", q);
      if (topic) params.set("topic", topic);
      try {
        const { items, total } = await api(`/api/research?${params}`);
        const html = items.map(studyItem).join("");
        if (reset) researchPage.innerHTML = html || `<li class="meta">No studies match that search yet.</li>`;
        else researchPage.insertAdjacentHTML("beforeend", html);
        offset += items.length;
        count.textContent = `${total} ${total === 1 ? "study" : "studies"} logged`;
        more.hidden = offset >= total;
      } catch (err) {
        researchPage.innerHTML = `<li class="meta">${esc(err.message)}</li>`;
      }
    };

    let t;
    form.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load(true), 300); });
    form.addEventListener("submit", (e) => { e.preventDefault(); load(true); });
    more.addEventListener("click", () => load(false));
    load(true);

    api("/api/research/log").then(({ runs }) => {
      const last = runs[0];
      if (last) $("#research-updated").textContent = `Last checked ${fmtDate(last.ran_at)}. ${last.added} new ${last.added === 1 ? "study" : "studies"} added in that run.`;
    }).catch(() => {});
  }

  // ---------- Stories ----------
  const storyCard = (s) => `<a class="story-card" href="/story?id=${s.id}">
    <h3>${esc(s.title)}</h3>
    <p>${esc(s.excerpt)}${s.excerpt && s.excerpt.length >= 320 ? "…" : ""}</p>
    <span class="meta"><span class="outcome ${esc(s.outcome)}">${esc(OUTCOME_LABELS[s.outcome] || "")}</span> ${esc(s.name)}, ${fmtDate(s.created_at)}${s.comment_count ? ` · ${s.comment_count} ${s.comment_count === 1 ? "comment" : "comments"}` : ""}</span>
  </a>`;

  $$("[data-story-list]").forEach(async (box) => {
    try {
      const { items } = await api(`/api/stories?limit=${box.dataset.limit || 20}`);
      if (items.length) box.innerHTML = items.map(storyCard).join("");
    } catch {}
  });

  const storyPage = $("[data-story-page]");
  if (storyPage) {
    const id = new URLSearchParams(location.search).get("id");
    const render = async () => {
      try {
        const { story, comments } = await api(`/api/stories/${encodeURIComponent(id)}`);
        document.title = `${story.title} | Gut Smart Live`;
        $("#story-title").textContent = story.title;
        $("#story-meta").innerHTML = `<span class="outcome ${esc(story.outcome)}">${esc(OUTCOME_LABELS[story.outcome] || "")}</span> ${esc(story.name)}, ${fmtDate(story.created_at)}`;
        $("#story-body").innerHTML = story.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
        $("#comments").innerHTML = comments.length
          ? comments.map((c) => `<div class="comment"><strong>${esc(c.name)}</strong> <span class="meta" style="display:inline">${fmtDate(c.created_at)}</span><p>${esc(c.body)}</p></div>`).join("")
          : `<p class="meta">No comments yet.</p>`;
        $("#comment-form").hidden = false;
      } catch (err) {
        $("#story-title").textContent = "Story not found";
        $("#story-body").innerHTML = `<p>${esc(err.message)} <a href="/stories">See all stories</a>.</p>`;
      }
    };
    render();
    wireForm($("#comment-form"), () => `/api/stories/${encodeURIComponent(id)}/comments`);
  }

  // ---------- Forms ----------
  function wireForm(form, urlFn, onDone) {
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const notice = $(".notice", form);
      const btn = $("button[type=submit]", form);
      const body = Object.fromEntries(new FormData(form).entries());
      notice.className = "notice";
      notice.textContent = "";
      btn.disabled = true;
      try {
        const data = await api(urlFn(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        notice.className = "notice ok";
        notice.textContent = data.message || "Done.";
        form.reset();
        onDone && onDone();
      } catch (err) {
        notice.className = "notice err";
        notice.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  $$("[data-subscribe]").forEach((f) => wireForm(f, () => "/api/subscribe"));
  wireForm($("#story-form"), () => "/api/stories");

  // Conditions page: open the condition named in the URL (e.g. /conditions#obesity)
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (el && el.tagName === "DETAILS") { el.open = true; el.scrollIntoView({ block: "start" }); }
  }
  if ($(".cond")) { openFromHash(); window.addEventListener("hashchange", openFromHash); }

  // Condition search: matches the name plus extra keywords (e.g. "weight" finds obesity)
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const matches = (el, q) => {
    const hay = norm(el.textContent + " " + (el.dataset.keywords || ""));
    return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  };
  const condSearch = $("#cond-search");
  if (condSearch) {
    const conds = $$(".cond");
    const empty = $("#cond-empty");
    const run = () => {
      const q = condSearch.value.trim();
      let shown = 0;
      conds.forEach((c) => {
        const ok = !q || matches(c.querySelector("summary"), q) || matches(c, q);
        c.hidden = !ok;
        if (ok) shown++;
      });
      empty.hidden = shown > 0;
      if (q && shown === 1) conds.find((c) => !c.hidden).open = true;
    };
    const q0 = new URLSearchParams(location.search).get("q");
    if (q0) { condSearch.value = q0; run(); }
    condSearch.addEventListener("input", run);
  }
  const finderQ = $("#finder-q");
  if (finderQ) {
    const chips = $$("#finder-chips a:not(.cond-all)");
    finderQ.addEventListener("input", () => {
      const q = finderQ.value.trim();
      chips.forEach((a) => { a.hidden = !!q && !matches(a, q); });
    });
  }
})();
