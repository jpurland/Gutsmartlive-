(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const OUTCOME = { worked: "It worked", mixed: "Mixed results", didnt: "Didn't work" };
  let password = "";
  try { password = sessionStorage.getItem("gsl-admin") || ""; } catch {}

  async function call(path, method = "GET") {
    const res = await fetch(path, { method, headers: { authorization: `Bearer ${password}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: res.status });
    return data;
  }

  function item(kind, x) {
    const head = kind === "stories"
      ? `<h3>${esc(x.title)}</h3><span class="meta">${esc(x.name)}${x.email ? " (" + esc(x.email) + ")" : ""} · ${esc(OUTCOME[x.outcome] || "")} · ${esc(x.created_at)} UTC</span>`
      : `<span class="meta">${esc(x.name)} on "${esc(x.story_title)}" · ${esc(x.created_at)} UTC</span>`;
    return `<div class="queue-item" data-kind="${kind}" data-id="${x.id}">${head}
      <div class="body">${esc(x.body)}</div>
      <div class="queue-actions"><button class="btn small" data-act="approve">Approve</button><button class="btn ghost small" data-act="reject">Reject</button></div></div>`;
  }

  async function load() {
    const q = await call("/api/admin/queue");
    $("#admin-login").hidden = true;
    $("#admin-panel").hidden = false;
    const last = q.lastRun ? `last check ${esc(q.lastRun.ran_at)} UTC, ${q.lastRun.added} added${q.lastRun.error ? ", error: " + esc(q.lastRun.error) : ""}` : "no checks yet";
    $("#admin-stats").innerHTML = `<div class="stat"><b>${q.stories.length}</b>stories waiting</div><div class="stat"><b>${q.comments.length}</b>comments waiting</div><div class="stat"><b>${q.subscribers}</b>subscribers</div><div class="stat"><b>${q.research}</b>studies logged, ${last}</div>`;
    $("#queue-stories").innerHTML = q.stories.length ? q.stories.map((s) => item("stories", s)).join("") : `<p class="empty">Nothing waiting.</p>`;
    $("#queue-comments").innerHTML = q.comments.length ? q.comments.map((c) => item("comments", c)).join("") : `<p class="empty">Nothing waiting.</p>`;
  }

  $("#admin-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    password = e.target.password.value;
    const notice = e.target.querySelector(".notice");
    try {
      await load();
      try { sessionStorage.setItem("gsl-admin", password); } catch {}
    } catch (err) {
      notice.className = "notice err";
      notice.textContent = err.status === 401 ? "That password isn't right." : err.message;
    }
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const box = btn.closest(".queue-item");
    btn.disabled = true;
    try {
      await call(`/api/admin/${box.dataset.kind}/${box.dataset.id}/${btn.dataset.act}`, "POST");
      await load();
    } catch (err) {
      btn.disabled = false;
      alert(err.message);
    }
  });

  $("#admin-fetch").addEventListener("click", async (e) => {
    e.target.disabled = true;
    $("#admin-fetch-status").textContent = "Checking PubMed…";
    try {
      const r = await call("/api/admin/fetch-research", "POST");
      $("#admin-fetch-status").textContent = `Found ${r.found}, added ${r.added} new.${r.errors.length ? " Errors: " + r.errors.join("; ") : ""}`;
      await load();
    } catch (err) {
      $("#admin-fetch-status").textContent = err.message;
    } finally {
      e.target.disabled = false;
    }
  });

  if (password) load().catch(() => { $("#admin-login").hidden = false; });
})();
