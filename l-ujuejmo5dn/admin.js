/* Letter desk (admin): mark JOE postings as applied, assign writers,
   edit where letters go, and send writers their updates. */
(function () {
  "use strict";
  const { Backend, METHODS, METHOD_ORDER, ROLE_LABEL, stepsFor, subjectFor, suggestWriters, composeEmail, composeNudge, composeDelegateEmail, composeDelegateNudge,
    recipientOf, versionsOf, versionFor, autoVersion, letterLabel, letterFile,
    fmtDay, dueInfo, esc, uid, safeUrl, copyText, mailto, gmail, sha256 } = LP;
  const $ = (id) => document.getElementById(id);
  const POSTINGS = window.JOE_POSTINGS || [];
  const PBYID = Object.fromEntries(POSTINGS.map((p) => [p.id, p]));
  const SESSION = "letterPortal.admin";
  let S = null;            // full state
  let tab = "apps";

  if (Backend.mode === "test") $("testbanner").hidden = false;

  /* ---------- gate --------------------------------------------- */
  async function load() {
    S = await Backend.getAll();
    // until a portal address is saved, emails link to index.html next to this page (when served over http)
    if (!S.settings.portalUrl && /^https?:/.test(location.href)) S.settings.portalUrl = location.href.replace(/admin\.html.*$/, "index.html").replace(/\/$/, "/index.html");
  }

  function unlocked() { try { return sessionStorage.getItem(SESSION) === "1"; } catch (e) { return false; } }
  $("gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("gateErr").textContent = "";
    if (Backend.mode === "live") {
      // the server checks the key; nothing is decided in the browser
      Backend.setKey($("pw").value);
      const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Checking…";
      try { await start(); }
      catch (err) { Backend.setKey(""); $("gateErr").textContent = err.code === "auth" ? "That's not it." : err.message; $("pw").select(); }
      btn.disabled = false; btn.textContent = "Open";
      return;
    }
    await load();
    const h = await sha256($("pw").value);
    if (h === S.settings.passHash) {
      try { sessionStorage.setItem(SESSION, "1"); } catch (e2) {}
      start();
    } else { $("gateErr").textContent = "That's not it."; $("pw").select(); }
  });

  // One-time switch-over: Michele Sykes submits letters for Yoto, Costas and Mark.
  async function ensureDelegate() {
    if (S.settings.delegateSetup === "done") return;
    if (!S.writers.some((w) => w.via)) {
      const list = S.writers.map((w) => Object.assign({}, w, {
        via: ["yotov", "syropoulos", "stehr"].includes(w.id) ? "sykes" : "",
        versions: w.id === "yotov" && !w.versions ? "Industry, Academic (research), Academic (teaching)" : (w.versions || ""),
      }));
      if (!list.some((w) => w.id === "sykes")) list.push({ id: "sykes", name: "Michele Sykes", first: "Michele", greet: "Dear Michele", email: "mms25@drexel.edu", role: "delegate", via: "", versions: "" });
      await Backend.saveWriters(list);
      await load();
      // an older backend silently drops the new columns: don't mark done until they stick
      if (!S.writers.some((w) => w.via === "sykes")) { toast("Update the Apps Script (backend/Code.gs) to finish adding Michele"); return; }
    }
    await Backend.saveSettings({ delegateSetup: "done" });
    await load();
  }

  async function start() {
    await load();
    await ensureDelegate();
    $("gate").hidden = true; $("main").hidden = false; $("tabs").hidden = false;
    fillMethodFilter();
    switchTab(S.apps.length ? "apps" : "postings");
  }

  /* ---------- tabs --------------------------------------------- */
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) switchTab(b.dataset.tab); });
  function switchTab(t) {
    tab = t;
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("current", b.dataset.tab === t));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== t));
    renderAll();
  }
  function renderCounts() {
    $("cApps").textContent = S.apps.length ? "(" + S.apps.length + ")" : "";
    $("cPost").textContent = "(" + POSTINGS.length + ")";
    const n = S.writers.filter((r) => (r.role === "delegate" ? S.writers.filter((x) => x.via === r.id) : recipientOf(S.writers, r) === r ? [r] : [])
      .some((w) => pendingFor(w).length)).length;
    $("cNotify").textContent = n ? "(" + n + ")" : "";
  }
  async function refresh() { await load(); renderAll(); }
  function renderAll() {
    renderCounts();
    if (tab === "apps") renderApps();
    if (tab === "postings") renderPostings();
    if (tab === "notify") renderNotify();
    if (tab === "writers") renderWriters();
    if (tab === "data") renderData();
  }

  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  /* ---------- status helpers ----------------------------------- */
  const kindOf = (a) => (METHODS[a.method] || METHODS.other).kind;
  function writerStatus(a, w) {
    if (kindOf(a) === "once" && S.platforms[w.id + "|" + a.method]) return "done";
    if (silent(a) && !S.progress[a.id + "|" + w.id]) return "notified";
    if (S.progress[a.id + "|" + w.id]) return "done";
    if (S.notified[a.id + "|" + w.id]) return "notified";
    return "pending";
  }
  // Interfolio: Interfolio itself asks for the letter, so writers get no email from me.
  // While "hold" is on (the default), Send only works for your own addresses,
  // so you can test with a writer row pointed at yourself.
  const OWN = ["blaizegiangiulio@gmail.com", "bg654@drexel.edu"];
  const held = () => S.settings.holdEmails !== "off";
  const blocked = (w) => held() && !OWN.concat([S.settings.myEmail, S.settings.cc]).map((x) => String(x || "").toLowerCase()).includes(String(w.email || "").toLowerCase());
  const silent = (a) => !!(METHODS[a.method] || {}).silent;
  // Applications a writer hasn't been told about. Skips Interfolio, "no letters", and
  // upload-once platforms the writer has already ticked (nothing for them to do).
  function pendingFor(w) {
    return S.apps.filter((a) => (a.writers || []).includes(w.id) && !S.notified[a.id + "|" + w.id] && kindOf(a) !== "none" &&
      !silent(a) && !(kindOf(a) === "once" && S.platforms[w.id + "|" + a.method]));
  }
  // writers on this application whose letter isn't sent/covered yet
  function outstanding(a) {
    const k = kindOf(a);
    if (k === "later" || k === "none") return [];
    return S.writers.filter((w) => (a.writers || []).includes(w.id) && writerStatus(a, w) !== "done" &&
      !(k === "once" && S.platforms[w.id + "|" + a.method]) && !S.progress[a.id + "|" + w.id]);
  }

  /* ---------- nudge drawer ------------------------------------- */
  function openNudge(appId) {
    const a = S.apps.find((x) => x.id === appId); if (!a) return;
    const ws = outstanding(a);
    const live = Backend.mode === "live";
    let h = '<button class="btn quiet close" type="button" data-close>Close ✕</button>';
    h += '<h3 id="edTitle">Nudge: ' + esc(a.institution) + "</h3>";
    h += '<p class="sec">' + esc(a.title) + " · " + (a.deadline ? "due " + esc(fmtDay(a.deadline, true)) + " (" + esc(dueInfo(a.deadline).text) + ")" : "no deadline") + "</p>";
    if (!ws.length) h += '<p class="allclear">Every writer has sent this one.</p>';
    const groups = [];
    ws.forEach((x) => { const r = recipientOf(S.writers, x); let g = groups.find((g) => g.r.id === r.id); if (!g) groups.push(g = { r, ws: [] }); g.ws.push(x); });
    groups.forEach(({ r: w, ws: gws }) => {
      const m = w.role === "delegate" ? composeDelegateNudge(S, w, a, gws) : composeNudge(S, w, a);
      const last = gws.map((x) => S.reminded[a.id + "|" + x.id]).filter(Boolean).sort().pop();
      h += '<div class="notify-card" data-nudge-writer="' + esc(w.id) + '"><header><h4>' + esc(w.name) + ' <span class="sans small muted">' + esc(w.email || "no email!") + "</span></h4>" +
        (w.role === "delegate" ? '<p class="sans small muted" style="margin:0.2rem 0 0">Submits for ' + esc(gws.map((x) => letterLabel(a, x)).join("; ")) + "</p>" : "") +
        '<span class="sans small muted">' + (last ? "Last nudged " + esc(fmtDay(last.slice(0, 10))) : "Not nudged yet") + "</span></header>" +
        '<label class="field" style="margin:0.6rem 0 0"><span>Subject</span><input type="text" data-subj value="' + esc(m.subject) + '"></label>' +
        '<label class="field" style="margin:0.6rem 0 0"><span>Message</span><textarea data-body rows="11">' + esc(m.body) + "</textarea></label>" +
        '<div class="btns" style="margin-top:0.6rem">' +
        (live
          ? (blocked(w) ? '<button class="btn" type="button" disabled style="opacity:0.45;cursor:not-allowed">Send — on hold</button>'
                        : '<button class="btn" type="button" data-nsend="server">Send nudge' + (S.settings.cc ? " (cc " + esc(S.settings.cc) + ")" : "") + "</button>")
          : '<button class="btn" type="button" data-nsend="gmail">Open in Gmail ↗</button><button class="btn ghost" type="button" data-nsend="mailto">Open in mail app</button>') +
        '<button class="btn ghost" type="button" data-nsend="copy">Copy text</button></div></div>';
    });
    $("drawer").innerHTML = h;
    $("drawer").querySelectorAll("[data-nudge-writer]").forEach((card) => {
      const w = S.writers.find((x) => x.id === card.dataset.nudgeWriter);
      const covers = groups.find((g) => g.r.id === w.id).ws;
      card.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-nsend]"); if (!b) return;
        const subj = card.querySelector("[data-subj]").value, body = card.querySelector("[data-body]").value;
        if (b.dataset.nsend === "copy") { copyText("To: " + w.email + (S.settings.cc ? "\nCc: " + S.settings.cc : "") + "\nSubject: " + subj + "\n\n" + body, b); return; }
        if (!w.email) { toast("Add " + w.first + "'s email on the Writers tab first"); return; }
        if (b.dataset.nsend === "gmail") { window.open(gmail(w.email, subj, body) + (S.settings.cc ? "&cc=" + encodeURIComponent(S.settings.cc) : ""), "_blank", "noopener"); }
        else if (b.dataset.nsend === "mailto") { location.href = mailto(w.email, subj, body) + (S.settings.cc ? "&cc=" + encodeURIComponent(S.settings.cc) : ""); }
        else {
          if (blocked(w)) { toast("Emails to writers are on hold (Data tab)"); return; }
          if (!confirm("Send this nudge to " + w.email + (S.settings.cc ? " (cc " + S.settings.cc + ")" : "") + "?")) return;
          b.disabled = true; b.textContent = "Sending…";
          try { await Backend.sendEmail({ to: w.email, subject: subj, body }); }
          catch (err) { toast(err.message); b.disabled = false; b.textContent = "Send nudge"; return; }
        }
        for (const x of covers) await Backend.markReminded(x.id, [a.id]);
        card.querySelector("header .muted:last-child").textContent = "Nudged just now";
        if (b.dataset.nsend === "server") { b.textContent = "Sent ✓"; toast("Nudge sent to " + (w.first || w.name)); }
        load();
      });
    });
    $("scrim").hidden = false; $("drawer").hidden = false; $("drawer").scrollTop = 0;
  }

  function recent(iso, days) { return !!iso && (Date.now() - new Date(iso).getTime()) < days * 864e5; }
  function appliedJoeIds() { const m = {}; S.apps.forEach((a) => { if (a.joeId) m[a.joeId] = a; }); return m; }
  function tagHtml(method, conf) {
    const M = METHODS[method] || METHODS.other;
    return '<span class="tag' + (conf === "low" ? " low" : "") + '" title="' + (conf ? "Parser confidence: " + conf : "") + '">' + esc(M.label) + (conf === "low" ? " ?" : "") + "</span>";
  }
  function dueCell(d) {
    const i = dueInfo(d);
    return '<div class="due ' + i.cls + '"><span class="d">' + (d ? esc(fmtDay(d, true)) : "—") + '</span><span class="r">' + esc(i.text) + "</span></div>";
  }
  const byDate = (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || (a.institution || "").localeCompare(b.institution || "");

  /* ---------- Applications tab --------------------------------- */
  $("appSearch").addEventListener("input", renderApps);
  $("appOpenOnly").addEventListener("change", renderApps);
  $("addManual").addEventListener("click", () => openEditor(blankApp(), true));

  function renderApps() {
    const q = $("appSearch").value.trim().toLowerCase();
    const openOnly = $("appOpenOnly").checked;
    let rows = S.apps.slice().sort(byDate);
    if (q) rows = rows.filter((a) => [a.institution, a.title, a.department, a.location].join(" ").toLowerCase().includes(q));
    if (openOnly) rows = rows.filter((a) => S.writers.some((w) => (a.writers || []).includes(w.id) && writerStatus(a, w) !== "done" && kindOf(a) !== "later"));
    $("appCount").textContent = S.apps.length ? rows.length + " of " + S.apps.length + " applications" : "";
    if (!S.apps.length) {
      $("appTable").innerHTML = '<tr><td class="empty">No applications yet. Mark postings as applied on the <a href="#" data-goto="postings">JOE Postings</a> tab, or add one by hand.</td></tr>';
      return;
    }
    let h = "<thead><tr><th>Deadline</th><th>Position</th><th>Letters via</th><th>Writers</th><th></th></tr></thead><tbody>";
    rows.forEach((a) => {
      const chips = S.writers.filter((w) => (a.writers || []).includes(w.id)).map((w) => {
        const st = writerStatus(a, w);
        const title = st === "done" ? "Sent / covered" : st === "notified" ? "Emailed " + fmtDay((S.notified[a.id + "|" + w.id] || "").slice(0, 10)) + "; not ticked yet" : "Not told yet — see Notify";
        return '<span class="chip ' + st + '" title="' + esc(title) + '">' + (st === "done" ? "✓ " : "") + esc(w.first || w.name) + "</span>";
      }).join("");
      h += "<tr><td>" + dueCell(a.deadline) + "</td>" +
        '<td><button class="linkish" data-edit="' + esc(a.id) + '"><div class="inst">' + esc(a.institution) + '</div><div>' + esc(a.title) + "</div></button>" +
        '<div class="sub">' + (a.joeId ? "JOE" : "Added by hand") + (a.appliedOn ? " · applied " + esc(fmtDay(a.appliedOn)) : "") + "</div></td>" +
        "<td>" + tagHtml(a.method) + '<div class="sub">' + (a.letters || 0) + " letter" + (a.letters == 1 ? "" : "s") + "</div></td>" +
        '<td><div class="chips">' + (chips || '<span class="sub">none</span>') + "</div></td>" +
        '<td class="act">' + (outstanding(a).length ? '<button class="btn small" data-nudge="' + esc(a.id) + '" title="Send a gentle reminder">Nudge</button> ' : "") +
        '<button class="btn ghost small" data-edit="' + esc(a.id) + '">Edit</button></td></tr>';
    });
    $("appTable").innerHTML = h + "</tbody>";
  }

  /* ---------- Postings tab ------------------------------------- */
  function fillMethodFilter() {
    const counts = {};
    POSTINGS.forEach((p) => (counts[p.method] = (counts[p.method] || 0) + 1));
    $("pMethod").innerHTML = '<option value="">Letters via: any</option>' + METHOD_ORDER.filter((m) => counts[m]).map((m) =>
      '<option value="' + m + '">' + esc(METHODS[m].label) + " (" + counts[m] + ")</option>").join("");
  }
  ["pSearch", "pType", "pMethod", "pPast", "pHideApplied"].forEach((id) => $(id).addEventListener(id === "pSearch" ? "input" : "change", renderPostings));

  function renderPostings() {
    const q = $("pSearch").value.trim().toLowerCase();
    const type = $("pType").value, method = $("pMethod").value;
    const showPast = $("pPast").checked, hideApplied = $("pHideApplied").checked;
    const applied = appliedJoeIds();
    let rows = POSTINGS.filter((p) => {
      if (type && !p.section.includes(type)) return false;
      if (method && p.method !== method) return false;
      if (!showPast && p.deadline && dueInfo(p.deadline).n < 0) return false;
      if (hideApplied && applied[p.id]) return false;
      if (q) {
        const hay = (p.institution + " " + p.title + " " + p.department + " " + p.location + " " + p.jel.join(" ") + " " + p.text).toLowerCase();
        if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    $("pCount").textContent = rows.length + " of " + POSTINGS.length + " postings" + (window.JOE_BUILT ? " · export processed " + window.JOE_BUILT : "");
    let h = '<thead><tr><th>Deadline</th><th>Position</th><th>Letters via</th><th class="hide-sm">#</th><th></th></tr></thead><tbody>';
    rows.forEach((p) => {
      const a = applied[p.id];
      h += "<tr" + (a ? ' class="applied"' : "") + "><td>" + dueCell(p.deadline) + "</td>" +
        '<td><button class="linkish" data-posting="' + esc(p.id) + '"><div class="inst">' + esc(p.institution) + "</div><div>" + esc(p.title) + "</div></button>" +
        '<div class="sub">' + esc([p.location, p.section.replace(/\s*\(.*\)/, "")].filter(Boolean).join(" · ")) + (p.teaching ? " · teaching-focused" : "") + "</div></td>" +
        "<td>" + tagHtml(p.method, p.confidence) + "</td>" +
        '<td class="num hide-sm">' + (p.letters || "–") + (p.lettersStated ? "" : '<span class="sub" title="Not stated in the ad; assumed"> ?</span>') + "</td>" +
        '<td class="act">' + (a ? '<button class="btn ghost small" data-edit="' + esc(a.id) + '">✓ Applied · edit</button>'
          : '<button class="btn small" data-posting="' + esc(p.id) + '">I applied…</button>') + "</td></tr>";
    });
    if (!rows.length) h += '<tr><td colspan="5" class="empty">No postings match.</td></tr>';
    $("pTable").innerHTML = h + "</tbody>";
  }

  /* ---------- editor drawer ------------------------------------ */
  function todayStr() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function blankApp() {
    return { id: uid(), joeId: "", institution: "", title: "", department: "", location: "", section: "", deadline: "", deadlineNote: "",
      method: "email", url: "", email: "", subject: "", instructions: "", note: "", adText: "", letters: 3, teaching: false,
      writers: suggestWriters(S.writers, 3, false), appliedOn: todayStr() };
  }
  function appFromPosting(p) {
    const method = p.method === "unknown" ? "other" : p.method;
    const letters = p.letters || (method === "none" ? 0 : 3);
    return { id: uid(), joeId: p.id, joeUrl: p.joeUrl, institution: p.institution, title: p.title, department: p.department, location: p.location,
      section: p.section, deadline: p.deadline, deadlineNote: p.reviewNote || "", method, url: p.applyUrl || "", email: p.letterEmail || "",
      subject: "", instructions: "", note: "", adText: p.letterText || "", letters, teaching: !!p.teaching,
      writers: suggestWriters(S.writers, letters, p.teaching), appliedOn: todayStr() };
  }

  let draft = null, draftIsNew = false;

  function openEditor(app, isNew) {
    draft = JSON.parse(JSON.stringify(app)); draftIsNew = !!isNew;
    const p = draft.joeId ? PBYID[draft.joeId] : null;
    const methodOpts = METHOD_ORDER.map((m) => '<option value="' + m + '"' + (draft.method === m ? " selected" : "") + ">" + esc(METHODS[m].label) +
      ({ once: " — one upload covers all", each: " — writer acts per application", later: " — only if shortlisted", none: "" }[METHODS[m].kind] || "") + "</option>").join("");
    const letterOpts = [0, 1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (draft.letters == n ? " selected" : "") + ">" + n + "</option>").join("");
    const viaName = (w) => { const r = recipientOf(S.writers, w); return r !== w ? " · sent by " + (r.first || r.name) : ""; };
    const writers = S.writers.filter((w) => w.role !== "delegate").map((w) => '<label><input type="checkbox" data-w="' + esc(w.id) + '"' + ((draft.writers || []).includes(w.id) ? " checked" : "") + "> " +
      esc(w.name) + ' <span class="role">' + esc(ROLE_LABEL[w.role] || "") + esc(viaName(w)) + (w.email ? "" : " · no email!") + "</span></label>").join("");
    draft.versions = draft.versions || {};
    verKey = null;

    let h = '<button class="btn quiet close" type="button" data-close>Close ✕</button>';
    h += '<h3 id="edTitle">' + esc(draft.institution || "New application") + "</h3>";
    h += '<p class="sec">' + esc([draft.title, draft.section, draft.location].filter(Boolean).join(" · ")) +
      (draft.joeUrl ? ' · <a href="' + esc(draft.joeUrl) + '" target="_blank" rel="noopener">JOE listing ↗</a>' : "") + "</p>";
    if (p) {
      h += '<div class="parsed"><b>What the parser read from the ad</b><p>Letters via <strong>' + esc((METHODS[p.method] || METHODS.other).label) + "</strong> (" + esc(p.confidence) + " confidence): " + esc(p.why) + ". " +
        (p.lettersStated ? p.letters + " letters stated in the ad." : "Number of letters not stated; assumed " + (p.letters || 0) + ".") +
        (p.confidence === "low" ? " <strong>Check this against how you actually applied.</strong>" : "") + "</p></div>";
    }
    h += '<form id="edForm" autocomplete="off">';
    h += '<div class="grid2"><label class="field"><span>Institution</span><input type="text" name="institution" required></label>' +
      '<label class="field"><span>Position title</span><input type="text" name="title" required></label></div>';
    h += '<div class="grid2"><label class="field"><span>Department</span><input type="text" name="department"></label>' +
      '<label class="field"><span>Location</span><input type="text" name="location"></label></div>';
    h += '<div class="grid3"><label class="field"><span>Letter deadline</span><input type="date" name="deadline"></label>' +
      '<label class="field"><span>I applied on</span><input type="date" name="appliedOn"></label>' +
      '<label class="field"><span>Letters requested</span><select name="letters">' + letterOpts + "</select></label></div>";
    h += '<label class="field"><span>Deadline note (shown to writers)</span><input type="text" name="deadlineNote" placeholder="e.g. Review begins Nov 1; letters by Nov 15"></label>';
    h += '<label class="field"><span>Letters go via</span><select name="method">' + methodOpts + "</select></label>";
    h += '<div class="grid2"><label class="field"><span>Upload / application link</span><input type="url" name="url" placeholder="https://…"></label>' +
      '<label class="field" data-only="email"><span>Send letters to (email)</span><input type="email" name="email" placeholder="search@university.edu"></label></div>';
    h += '<label class="field" data-only="email"><span>Email subject for writers</span><input type="text" name="subject" placeholder="' + esc(subjectFor(Object.assign({}, draft, { subject: "" }), S.settings.me)) + '"></label>';
    h += '<label class="field"><span>Letter writers</span></label><div class="writers-pick" id="wPick">' + writers + "</div>";
    h += '<div id="verPick"></div>';
    h += '<p class="rulehint"><label style="display:inline-flex;gap:0.4rem;align-items:center"><input type="checkbox" name="teaching"' + (draft.teaching ? " checked" : "") +
      "> Teaching-focused job</label> · <span id=\"ruleText\"></span> <button class=\"btn quiet small\" type=\"button\" id=\"applyRule\">Use rule</button></p>";
    h += '<label class="field"><span>Extra step for writers (optional)</span><input type="text" name="instructions" placeholder="e.g. Address the letter to Prof. Smith, Search Chair"></label>';
    h += '<label class="field"><span>Note to writers (optional, shown as “Note from Blaize”)</span><textarea name="note" rows="2"></textarea></label>';
    h += '<label class="field"><span>What the ad says about letters (shown to writers)</span><textarea name="adText" rows="3"></textarea></label>';
    h += '<div class="preview"><div class="k">What writers will see</div><div id="edPreview"></div></div>';
    h += '<div class="btns"><button class="btn" type="submit">' + (draftIsNew ? "Save application" : "Save changes") + "</button>" +
      '<button class="btn ghost" type="button" data-close>Cancel</button>' +
      (!draftIsNew ? '<button class="btn danger" type="button" id="edDelete" style="margin-left:auto">Remove application</button>' : "") + "</div>";
    h += "</form>";
    if (p) h += '<details style="margin-top:1.6rem"><summary class="sans small" style="cursor:pointer;color:var(--accent)">Full text of the JOE ad</summary><div class="fulltext">' + esc(p.text) + "</div></details>";

    $("drawer").innerHTML = h;
    const f = $("edForm");
    ["institution", "title", "department", "location", "deadline", "appliedOn", "deadlineNote", "url", "email", "subject", "instructions", "note", "adText"].forEach((k) => { f.elements[k].value = draft[k] || ""; });
    f.addEventListener("input", syncDraft);
    f.addEventListener("change", syncDraft);
    f.addEventListener("submit", saveDraft);
    $("applyRule").addEventListener("click", () => {
      draft.writers = suggestWriters(S.writers, +f.elements.letters.value, f.elements.teaching.checked);
      document.querySelectorAll("#wPick [data-w]").forEach((c) => (c.checked = draft.writers.includes(c.dataset.w)));
      syncDraft();
    });
    if ($("edDelete")) $("edDelete").addEventListener("click", async () => {
      if (!confirm("Remove this application? It disappears from every writer's list.")) return;
      await Backend.deleteApp(draft.id); closeEditor(); toast("Removed"); refresh();
    });
    syncDraft();
    $("scrim").hidden = false; $("drawer").hidden = false; $("drawer").scrollTop = 0;
    f.elements.institution.value ? f.elements.deadline.focus() : f.elements.institution.focus();
  }

  // Which version of a writer's letter to send (e.g. Yoto: Industry / Academic (research) / Academic (teaching)).
  let verKey = null;
  function renderVerPick(force) {
    const ws = S.writers.filter((w) => draft.writers.includes(w.id) && versionsOf(w).length);
    const key = ws.map((w) => w.id).join(",");
    if (!force && key === verKey) return;
    verKey = key;
    $("verPick").innerHTML = ws.map((w) => {
      const cur = versionFor(draft, w), auto = autoVersion(draft, w);
      return '<label class="field" style="max-width:24rem"><span>Which ' + esc(w.first || w.name) + " letter</span><select data-ver=\"" + esc(w.id) + '">' +
        versionsOf(w).map((v) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(letterFile(v).name + (letterFile(v).file ? " — " + letterFile(v).file : "")) + (v === auto ? " (suggested)" : "") + "</option>").join("") + "</select></label>";
    }).join("");
  }

  function syncDraft(e) {
    const f = $("edForm"); if (!f) return;
    document.querySelectorAll("#verPick [data-ver]").forEach((sel) => { draft.versions[sel.dataset.ver] = sel.value; });
    ["institution", "title", "department", "location", "deadline", "appliedOn", "deadlineNote", "method", "url", "email", "subject", "instructions", "note", "adText"]
      .forEach((k) => (draft[k] = f.elements[k].value.trim()));
    draft.letters = +f.elements.letters.value;
    const teachingChanged = draft.teaching !== f.elements.teaching.checked;
    draft.teaching = f.elements.teaching.checked;
    if (teachingChanged) draft.versions = {};   // re-suggest which letter version fits
    // letters / teaching changed by hand → re-suggest writers
    if (e && e.type === "change" && (e.target.name === "letters" || e.target.name === "teaching")) {
      draft.writers = suggestWriters(S.writers, draft.letters, draft.teaching);
      document.querySelectorAll("#wPick [data-w]").forEach((c) => (c.checked = draft.writers.includes(c.dataset.w)));
    } else {
      draft.writers = [...document.querySelectorAll("#wPick [data-w]")].filter((c) => c.checked).map((c) => c.dataset.w);
    }
    renderVerPick(teachingChanged);
    document.querySelectorAll("#verPick [data-ver]").forEach((sel) => { draft.versions[sel.dataset.ver] = sel.value; });
    Object.keys(draft.versions).forEach((id) => { if (!draft.writers.includes(id)) delete draft.versions[id]; });
    document.querySelectorAll("[data-only]").forEach((el) => (el.style.display = el.dataset.only === draft.method ? "" : "none"));
    const sug = suggestWriters(S.writers, draft.letters, draft.teaching);
    const names = sug.map((id) => (S.writers.find((w) => w.id === id) || {}).first).join(", ");
    const same = sug.length === draft.writers.length && sug.every((x) => draft.writers.includes(x));
    $("ruleText").textContent = "Rule for " + draft.letters + " letter" + (draft.letters == 1 ? "" : "s") + ": " + (names || "nobody") + (same ? " ✓" : " (you've changed this)");
    // preview
    const { steps, label } = stepsFor(draft, S.settings.me);
    let pv = '<p class="sans small" style="margin:0 0 0.4rem"><span class="tag">' + esc(label) + "</span> " +
      (draft.deadline ? "Due " + esc(fmtDay(draft.deadline, true)) : "No deadline") + "</p>";
    if (draft.note) pv += '<p class="small" style="margin:0 0 0.4rem"><em>Note from Blaize:</em> ' + esc(draft.note) + "</p>";
    pv += '<ol style="margin:0;padding-left:1.2rem">' + steps.map((s) => "<li>" + s + "</li>").join("") + (draft.instructions ? "<li>" + esc(draft.instructions) + "</li>" : "") + "</ol>";
    const warn = [];
    if (draft.method === "email" && !draft.email) warn.push("Add the email address letters should go to.");
    if (draft.writers.some((id) => !(S.writers.find((w) => w.id === id) || {}).email)) warn.push("One of the chosen writers has no email address yet (Writers tab).");
    if (draft.writers.length < draft.letters) warn.push("Fewer writers chosen than letters requested.");
    if (warn.length) pv += '<p class="sans small" style="color:var(--warn);margin:0.6rem 0 0">' + warn.map(esc).join(" ") + "</p>";
    $("edPreview").innerHTML = pv;
  }

  async function saveDraft(e) {
    e.preventDefault(); syncDraft();
    if (!draft.institution || !draft.title) { toast("Institution and title are needed"); return; }
    await Backend.saveApp(draft);
    const n = silent(draft) ? 0 : draft.writers.filter((id) => !S.notified[draft.id + "|" + id] && !(kindOf(draft) === "once" && S.platforms[id + "|" + draft.method])).length;
    closeEditor(); await refresh();
    toast(n ? "Saved — " + n + " writer" + (n > 1 ? "s" : "") + " waiting on the Notify tab" : "Saved");
  }
  function closeEditor() { $("drawer").hidden = true; $("scrim").hidden = true; $("drawer").innerHTML = ""; draft = null; }
  $("scrim").addEventListener("click", closeEditor);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("drawer").hidden) closeEditor(); });

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]"); if (c) { closeEditor(); return; }
    const nu = e.target.closest("[data-nudge]"); if (nu) { openNudge(nu.dataset.nudge); return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) { const a = S.apps.find((x) => x.id === ed.dataset.edit); if (a) openEditor(Object.assign({ joeUrl: (PBYID[a.joeId] || {}).joeUrl }, a), false); return; }
    const po = e.target.closest("[data-posting]");
    if (po) {
      const existing = S.apps.find((x) => x.joeId === po.dataset.posting);
      existing ? openEditor(Object.assign({ joeUrl: (PBYID[existing.joeId] || {}).joeUrl }, existing), false) : openEditor(appFromPosting(PBYID[po.dataset.posting]), true);
      return;
    }
    const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); switchTab(g.dataset.goto); }
  });

  /* ---------- Notify tab --------------------------------------- */
  function renderNotify() {
    const holdNote = Backend.mode === "live" && held() ? '<p style="margin:0.5rem 0 0"><strong>On hold:</strong> Send only works for your own addresses until you untick “Hold emails” on the Data tab. To try it, add yourself as a writer (blaizegiangiulio@gmail.com) on the Writers tab and assign yourself to an application.</p>' : "";
    $("notifyCallout").innerHTML = (Backend.mode === "test"
      ? "<strong>Test mode:</strong> each email opens pre-filled in Gmail or your mail app, and you press send. Then click <em>Mark as emailed</em> so it isn't sent twice. Once the Google Sheet backend is connected, the Send button emails them for you."
      : "Each <strong>Send</strong> emails the writer from your Gmail" + (S.settings.cc ? ", with " + esc(S.settings.cc) + " on cc" : "") +
        ". Interfolio applications never appear here, because Interfolio asks for the letter itself. Neither do JOE or EJM applications once the writer has ticked that upload.") + holdNote;
    // One card per person who receives email: writers who submit their own letters, and assistants
    // (who get everything for the writers they submit for). Pairs are {app, w}.
    const remindable = (a, w) => S.notified[a.id + "|" + w.id] && writerStatus(a, w) !== "done" && kindOf(a) === "each" &&
      a.deadline && dueInfo(a.deadline).n >= 0 && dueInfo(a.deadline).n <= 10 &&
      !recent(S.reminded[a.id + "|" + w.id], 4) && !recent(S.notified[a.id + "|" + w.id], 4);
    const out = [];
    S.writers.forEach((r) => {
      if (r.role !== "delegate" && recipientOf(S.writers, r) !== r) return;   // their mail goes to the assistant
      const ws = r.role === "delegate" ? S.writers.filter((x) => x.via === r.id) : [r];
      const pend = [], rems = [];
      ws.forEach((w) => {
        pendingFor(w).forEach((a) => pend.push({ app: a, w }));
        S.apps.filter((a) => (a.writers || []).includes(w.id) && remindable(a, w)).forEach((a) => rems.push({ app: a, w }));
      });
      if (!pend.length && !rems.length) return;
      out.push({ r, delegate: r.role === "delegate", pend, rems });
    });
    const appsOf = (pairs) => [...new Map(pairs.map((p) => [p.app.id, p.app])).values()];
    const itemsOf = (pairs) => appsOf(pairs).map((a) => ({ app: a, writers: pairs.filter((p) => p.app.id === a.id).map((p) => p.w) }));
    function compose(c, withRem) {
      if (c.delegate) {
        if (!c.pend.length) {
          const m = composeDelegateEmail(S, c.r, itemsOf(c.rems), { intro: "A quick reminder — these letters are due in the next ten days:" });
          m.subject = "Reminder: letters due soon"; return m;
        }
        return composeDelegateEmail(S, c.r, itemsOf(withRem ? c.pend.concat(c.rems) : c.pend));
      }
      if (!c.pend.length) {
        const m = composeEmail(S, c.r, appsOf(c.rems), {});
        m.subject = "Reminder: " + c.rems.length + " letter" + (c.rems.length > 1 ? "s" : "") + " due soon";
        m.body = m.body.replace(/^I've submitted.*$/m, "A quick reminder — these are due in the next ten days:");
        return m;
      }
      return composeEmail(S, c.r, appsOf(c.pend), { reminders: withRem ? appsOf(c.rems) : [] });
    }
    async function markDone(c, remSent) {
      const byW = (pairs) => { const m = {}; pairs.forEach((p) => (m[p.w.id] = m[p.w.id] || []).push(p.app.id)); return m; };
      const pn = byW(c.pend), rn = byW(c.rems);
      for (const id of Object.keys(pn)) await Backend.markNotified(id, pn[id]);
      if (remSent) for (const id of Object.keys(rn)) await Backend.markReminded(id, rn[id]);
    }
    if (!out.length) {
      $("notifyList").innerHTML = '<p class="allclear">Everyone is up to date.</p>';
      return;
    }
    $("notifyList").innerHTML = out.map((c, i) => {
      const mail = compose(c, false);
      const nP = appsOf(c.pend).length, nR = appsOf(c.rems).length;
      const forWho = c.delegate ? '<p class="sans small muted" style="margin:0.25rem 0 0">Submits letters for ' + esc(S.writers.filter((x) => x.via === c.r.id).map((x) => x.first || x.name).join(", ")) + "</p>" : "";
      return '<div class="notify-card" data-i="' + i + '" data-writer="' + esc(c.r.id) + '">' +
        "<header><h4>" + esc(c.r.name) + ' <span class="sub sans small muted">' + esc(c.r.email || "no email address!") + "</span></h4>" +
        '<span class="sans small muted">' + (nP ? nP + " new application" + (nP > 1 ? "s" : "") : "") +
        (nP && nR ? " · " : "") + (nR ? nR + " due within 10 days" : "") + "</span></header>" + forWho +
        (nP && nR ? '<label class="inline sans small muted" style="display:inline-flex;gap:0.35rem;margin-top:0.4rem"><input type="checkbox" data-rem> Also remind about the ' + nR + " open application" + (nR > 1 ? "s" : "") + " due soon</label>" : "") +
        '<label class="field" style="margin:0.6rem 0 0"><span>Subject</span><input type="text" data-subj value="' + esc(mail.subject) + '"></label>' +
        '<label class="field" style="margin:0.6rem 0 0"><span>Message</span><textarea data-body rows="14">' + esc(mail.body) + "</textarea></label>" +
        '<div class="btns" style="margin-top:0.6rem">' +
        (Backend.mode === "live"
          ? (blocked(c.r)
            ? '<button class="btn" type="button" disabled style="opacity:0.45;cursor:not-allowed" title="Emails are on hold (Data tab)">Send — on hold</button>'
            : '<button class="btn" type="button" data-send="server">Send' + (S.settings.cc ? " (cc " + esc(S.settings.cc) + ")" : "") + "</button>")
          : '<button class="btn" type="button" data-send="gmail">Open in Gmail ↗</button>' +
            '<button class="btn ghost" type="button" data-send="mailto">Open in mail app</button>') +
        '<button class="btn ghost" type="button" data-send="copy">Copy text</button>' +
        '<button class="btn quiet" type="button" data-mark style="margin-left:auto">Mark as emailed</button></div></div>';
    }).join("");
    $("notifyList").querySelectorAll(".notify-card").forEach((card) => {
      const c = out[+card.dataset.i], w = c.r;
      const rem = card.querySelector("[data-rem]");
      if (rem) rem.addEventListener("change", () => { card.querySelector("[data-body]").value = compose(c, rem.checked).body; });
      card.addEventListener("click", async (e) => {
        const subj = card.querySelector("[data-subj]").value, body = card.querySelector("[data-body]").value;
        const remSent = !c.pend.length || (rem && rem.checked);
        const s = e.target.closest("[data-send]");
        if (s) {
          if (!w.email) { toast("Add " + w.first + "'s email on the Writers tab first"); return; }
          if (s.dataset.send === "server") {
            if (blocked(w)) { toast("Emails are on hold (Data tab)"); return; }
            if (!confirm("Send this email to " + w.email + (S.settings.cc ? " (cc " + S.settings.cc + ")" : "") + "?")) return;
            s.disabled = true; s.textContent = "Sending…";
            try { await Backend.sendEmail({ to: w.email, subject: subj, body }); }
            catch (err) { toast(err.message); s.disabled = false; s.textContent = "Send"; return; }
            await markDone(c, remSent);
            toast("Sent to " + (w.first || w.name)); refresh();
            return;
          }
          if (s.dataset.send === "gmail") window.open(gmail(w.email, subj, body), "_blank", "noopener");
          if (s.dataset.send === "mailto") location.href = mailto(w.email, subj, body);
          if (s.dataset.send === "copy") copyText("To: " + w.email + "\nSubject: " + subj + "\n\n" + body, s);
          return;
        }
        if (e.target.closest("[data-mark]")) { await markDone(c, remSent); toast("Marked as emailed"); refresh(); }
      });
    });
  }

  /* ---------- Writers tab -------------------------------------- */
  function renderWriters() {
    const roleOpts = (r) => Object.keys(ROLE_LABEL).map((k) => '<option value="' + k + '"' + (k === r ? " selected" : "") + ">" + esc(ROLE_LABEL[k]) + "</option>").join("");
    const delegates = S.writers.filter((w) => w.role === "delegate");
    const viaOpts = (w) => '<option value="">Themselves</option>' + delegates.filter((d) => d.id !== w.id).map((d) =>
      '<option value="' + esc(d.id) + '"' + (w.via === d.id ? " selected" : "") + ">" + esc(d.name) + "</option>").join("");
    $("wTable").innerHTML = "<thead><tr><th>Full name</th><th>Called</th><th>Email greeting</th><th>Email (sign-in)</th><th>Role</th><th>Letters sent by</th><th>Letter versions</th><th></th></tr></thead><tbody>" +
      S.writers.map((w, i) => '<tr data-row="' + i + '" data-id="' + esc(w.id) + '">' +
        '<td><input type="text" data-k="name" value="' + esc(w.name) + '"></td>' +
        '<td><input type="text" data-k="first" value="' + esc(w.first) + '"></td>' +
        '<td><input type="text" data-k="greet" value="' + esc(w.greet || "") + '"></td>' +
        '<td><input type="email" data-k="email" value="' + esc(w.email) + '" placeholder="needed to sign in"></td>' +
        '<td><select data-k="role">' + roleOpts(w.role) + "</select></td>" +
        '<td>' + (w.role === "delegate" ? '<input type="hidden" data-k="via" value=""><span class="sub">—</span>' : '<select data-k="via">' + viaOpts(w) + "</select>") + "</td>" +
        '<td><input type="text" data-k="versions" value="' + esc(w.versions || "") + '" placeholder="optional, comma-separated" title="e.g. Industry, Academic (research), Academic (teaching)"></td>' +
        '<td class="act"><a class="btn quiet small" href="index.html?u=' + encodeURIComponent(w.email || "") + '" target="_blank" rel="noopener">View as ↗</a></td></tr>').join("") + "</tbody>";
  }
  function readWriters() {
    return [...$("wTable").querySelectorAll("tr[data-row]")].map((tr) => {
      const o = { id: tr.dataset.id };
      tr.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim()));
      if (!o.first) o.first = o.name.split(" ")[0];
      if (!o.greet) o.greet = "Dear " + o.first;
      return o;
    });
  }
  $("wSave").addEventListener("click", async () => {
    const list = readWriters();
    const emails = list.map((w) => w.email.toLowerCase()).filter(Boolean);
    if (new Set(emails).size !== emails.length) { toast("Two writers share an email address"); return; }
    await Backend.saveWriters(list); toast("Writers saved"); refresh();
  });
  $("wAdd").addEventListener("click", () => {
    S.writers = readWriters().concat([{ id: "w" + uid().slice(1, 8), name: "", first: "", greet: "", email: "", role: "extra" }]);
    renderWriters();
  });

  /* ---------- Data tab ----------------------------------------- */
  function renderData() {
    $("sMe").value = S.settings.me || "";
    $("sMyEmail").value = S.settings.myEmail || "";
    $("sPortal").value = S.settings.portalUrl || "";
    $("sCc").value = S.settings.cc || "";
    $("sHold").checked = held();
    document.querySelectorAll("[data-testonly]").forEach((el) => (el.hidden = Backend.mode !== "test"));
    if (!S.settings.portalUrl && /^https?:/.test(location.href)) $("sPortal").placeholder = location.href.replace(/admin\.html.*$/, "");
    $("builtNote").textContent = "JOE postings: " + POSTINGS.length + " from the export processed " + (window.JOE_BUILT || "?") +
      ". To refresh, save a new JOE XML export into listings/ and run  python3 build_postings.py  in this folder.";
  }
  $("sSave").addEventListener("click", async () => {
    await Backend.saveSettings({ me: $("sMe").value.trim(), myEmail: $("sMyEmail").value.trim(), portalUrl: $("sPortal").value.trim(), cc: $("sCc").value.trim(), holdEmails: $("sHold").checked ? "on" : "off" });
    toast("Settings saved"); refresh();
  });
  $("pwSave").addEventListener("click", async () => {
    const a = $("pw1").value, b = $("pw2").value;
    if (!a || a !== b) { toast("Passwords don't match"); return; }
    await Backend.saveSettings({ passHash: await sha256(a) }); $("pw1").value = $("pw2").value = ""; toast("Password changed");
  });
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "letter-desk-" + todayStr() + ".json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || obj.version !== 1 || !Array.isArray(obj.apps)) throw new Error("bad");
      if (!confirm("Replace everything here with " + obj.apps.length + " applications from the file?")) return;
      await Backend.replaceAll(obj); toast("Imported"); refresh();
    } catch (err) { toast("That file isn't a Letter Desk export"); }
    e.target.value = "";
  });
  $("resetBtn").addEventListener("click", async () => {
    if (!confirm("Erase all applications, writer progress and settings in this browser? (Export first if you want a copy.)")) return;
    await Backend.reset(); try { sessionStorage.removeItem(SESSION); } catch (e) {} location.reload();
  });
  $("demoBtn").addEventListener("click", async () => {
    const future = POSTINGS.filter((p) => p.deadline && dueInfo(p.deadline).n >= 2);
    const pick = (m, c) => future.find((p) => p.method === m && (!c || p.confidence === c) && !S.apps.some((a) => a.joeId === p.id));
    const chosen = [pick("email", "high"), pick("joe", "high") || pick("joe"), pick("joe"), pick("ejm"), pick("interfolio", "high"), pick("ajo"), pick("portal", "medium") || pick("portal"), pick("later")].filter(Boolean);
    const teach = future.find((p) => p.teaching && p.method !== "none" && !chosen.includes(p));
    if (teach) chosen.push(teach);
    for (const p of chosen) await Backend.saveApp(appFromPosting(p));
    const soon = new Date(Date.now() + 5 * 864e5);
    const manual = Object.assign(blankApp(), { institution: "Cornerstone Research", title: "Associate (PhD)", method: "email", email: "recruiting@example.com",
      deadline: soon.getFullYear() + "-" + String(soon.getMonth() + 1).padStart(2, "0") + "-" + String(soon.getDate()).padStart(2, "0"),
      letters: 2, writers: suggestWriters(S.writers, 2, false), note: "Demo entry added by hand — not a real address." });
    await Backend.saveApp(manual);
    toast("Added " + (chosen.length + 1) + " demo applications"); await refresh(); switchTab("apps");
  });

  /* ---------- start -------------------------------------------- */
  Backend.onChange(() => { if (!draft) refresh(); });
  window.addEventListener("unhandledrejection", (e) => { toast((e.reason && e.reason.message) || "Something went wrong"); });
  (async () => {
    const showGate = () => { $("gate").hidden = false; $("pw").focus(); };
    if (Backend.mode === "live") {
      if (!Backend.hasKey()) return showGate();
      try { await start(); } catch (err) { Backend.setKey(""); showGate(); }
      return;
    }
    await load(); if (unlocked()) start(); else showGate();
  })();
})();
