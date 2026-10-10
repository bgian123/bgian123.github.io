/* Writer portal: sign in by email, see queue, tick letters off. */
(function () {
  "use strict";
  const { Backend, METHODS, stepsFor, subjectFor, fmtDay, dueInfo, esc, safeUrl, copyText, mailto } = LP;
  const $ = (id) => document.getElementById(id);
  const ME_KEY = "letterPortal.me";
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

  let current = null;           // writer object
  const openHow = new Set();    // app ids whose instructions are expanded

  if (Backend.mode === "test") $("testbanner").hidden = false;

  function remember(email) { try { email ? localStorage.setItem(ME_KEY, email) : localStorage.removeItem(ME_KEY); } catch (e) {} }
  function remembered() { try { return localStorage.getItem(ME_KEY) || ""; } catch (e) { return ""; } }

  async function signIn(email, quiet) {
    let w = null;
    try { w = await Backend.findWriter(email); }
    catch (e) { $("signinErr").textContent = e.message; showSignin(email); return; }
    if (!w) {
      if (!quiet) $("signinErr").textContent = "I don't have that address on my list. Try the address I usually email you at, or write to me.";
      showSignin(email);
      return;
    }
    current = w; remember(w.email);
    $("signin").hidden = true; $("queue").hidden = false;
    await render();
  }

  function showSignin(prefill) {
    current = null;
    $("queue").hidden = true; $("signin").hidden = false;
    if (prefill) $("emailInput").value = prefill;
    $("emailInput").focus();
  }

  $("signinForm").addEventListener("submit", (e) => { e.preventDefault(); $("signinErr").textContent = ""; signIn($("emailInput").value); });
  $("signout").addEventListener("click", () => { remember(""); history.replaceState(null, "", location.pathname); showSignin(""); });

  /* ---------- rendering ---------------------------------------- */

  const byDate = (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.institution.localeCompare(b.institution);

  function dueBlock(app) {
    const d = dueInfo(app.deadline);
    return '<div class="due ' + d.cls + '"><span class="d">' + (app.deadline ? esc(fmtDay(app.deadline)) : "—") + '</span><span class="r">' + esc(d.text) + "</span></div>";
  }

  function checkBtn(on, label, attrs) {
    return '<button type="button" class="check' + (on ? " on" : "") + '" aria-pressed="' + on + '" ' + attrs + '><span class="box">' + CHECK_SVG + "</span>" + label + "</button>";
  }

  function howPanel(app, me) {
    const { steps } = stepsFor(app, me);
    let h = '<div class="how" id="how-' + esc(app.id) + '"' + (openHow.has(app.id) ? "" : " hidden") + ">";
    if (app.note) h += '<div class="note"><b>Note from Blaize</b>' + esc(app.note) + "</div>";
    h += "<ol>" + steps.map((s) => "<li>" + s + "</li>").join("");
    if (app.instructions) h += "<li>" + esc(app.instructions) + "</li>";
    h += "</ol>";

    const btns = [];
    const url = safeUrl(app.url);
    if (app.method === "email" && app.email) {
      const body = "Please find attached my letter of recommendation for " + me + ", who has applied for the " + app.title + " position at " + app.institution + ".";
      btns.push('<a class="btn" href="' + esc(mailto(app.email, subjectFor(app, me), body)) + '">Compose email</a>');
      btns.push('<button class="btn ghost small" type="button" data-copy="' + esc(app.email) + '">Copy address</button>');
      btns.push('<button class="btn ghost small" type="button" data-copy="' + esc(subjectFor(app, me)) + '">Copy subject</button>');
    } else if (METHODS[app.method] && METHODS[app.method].kind === "once" && METHODS[app.method].home) {
      btns.push('<a class="btn ghost" href="' + esc(METHODS[app.method].home) + '" target="_blank" rel="noopener">Open ' + esc(METHODS[app.method].label) + " ↗</a>");
    }
    if (url && (METHODS[app.method] || {}).kind !== "once") {
      btns.push('<a class="btn ghost" href="' + esc(url) + '" target="_blank" rel="noopener">' + (app.method === "portal" || app.method === "later" || app.method === "email" ? "Job posting ↗" : "Upload page ↗") + "</a>");
    }
    if (btns.length) h += '<div class="btns">' + btns.join("") + "</div>";

    const facts = [];
    if (app.department) facts.push(esc(app.department));
    if (app.location) facts.push(esc(app.location));
    if (app.letters) facts.push(app.letters + " letter" + (app.letters > 1 ? "s" : "") + " requested");
    if (app.deadlineNote) facts.push(esc(app.deadlineNote));
    if (facts.length) h += '<p class="kv">' + facts.join(" · ") + "</p>";
    if (app.adText) h += "<details><summary>What the job ad says about letters</summary><blockquote>" + esc(app.adText) + "</blockquote></details>";
    h += "</div>";
    return h;
  }

  function rowHtml(app, me, opts) {
    const M = METHODS[app.method] || METHODS.other;
    let right = "";
    if (opts.check) right = checkBtn(!!opts.done, opts.done ? "Sent" : "Sent?", 'data-done="' + esc(app.id) + '"');
    return '<li data-app="' + esc(app.id) + '"><div class="row">' + dueBlock(app) +
      '<div class="what"><p class="inst">' + esc(app.institution) + '</p><p class="ttl">' + esc(app.title) + "</p>" +
      '<div class="meta"><span class="tag' + (M.kind === "once" ? " gold" : "") + '">' + esc(M.label) + "</span>" +
      '<button class="toggle-how" type="button" data-how="' + esc(app.id) + '" aria-expanded="' + openHow.has(app.id) + '" aria-controls="how-' + esc(app.id) + '">' +
      (opts.done ? "Details" : "How to submit") + "</button></div></div>" + right + "</div>" + howPanel(app, me) + "</li>";
  }

  async function render() {
    if (!current) return;
    let q;
    try { q = await Backend.getQueue(current); }
    catch (e) { $("todo").innerHTML = '<li class="empty">' + esc(e.message) + "</li>"; return; }
    current = q.writer || current;
    const me = q.settings.me || "Blaize Giangiulio";
    if (q.settings.myEmail) {
      ["contactLink", "footMail"].forEach((id) => { $(id).href = "mailto:" + q.settings.myEmail; $(id).textContent = q.settings.myEmail; });
    }
    $("hello").textContent = "Welcome, " + (current.first || current.name);
    $("whoEmail").textContent = current.email;

    const apps = q.apps.slice().sort(byDate);
    const kind = (a) => (METHODS[a.method] || METHODS.other).kind;
    const todo = [], done = [], later = [];
    const platformApps = {};
    apps.forEach((a) => {
      const k = kind(a);
      if (k === "once") (platformApps[a.method] = platformApps[a.method] || []).push(a);
      else if (k === "later") later.push(a);
      else if (k === "none") {}
      else if (q.done[a.id]) done.push(a);
      else todo.push(a);
    });

    // platform cards
    let ph = "", openPlatforms = 0, covered = 0;
    Object.keys(platformApps).sort((x, y) => (!!q.platforms[x]) - (!!q.platforms[y])).forEach((m) => {
      const list = platformApps[m], M = METHODS[m];
      const isDone = !!q.platforms[m];
      const listHtml = "<ul>" + list.map((a) => "<li>" + esc(a.institution) + " — " + esc(a.title) + (a.deadline ? " (" + esc(fmtDay(a.deadline)) + ")" : "") + "</li>").join("") + "</ul>";
      if (isDone) {
        covered += list.length;
        ph += '<div class="platform done"><div class="ptitle"><div><span class="k">' + esc(M.label) + ' · uploaded</span>' +
          "<p>Your letter " + (m === "interfolio" ? "in " : "on ") + esc(M.platform) + " covers " + list.length + " application" + (list.length > 1 ? "s" : "") + ". Nothing else to do for these, including any I add later.</p></div>" +
          checkBtn(true, "Done", 'data-platform="' + m + '"') + "</div><details><summary>Show the " + list.length + " application" + (list.length > 1 ? "s" : "") + "</summary>" + listHtml + "</details></div>";
      } else {
        openPlatforms++;
        const first = list.find((a) => a.deadline && dueInfo(a.deadline).n >= 0) || list[0];
        const steps = M.onceText || "";
        ph += '<div class="platform"><div class="ptitle"><div><span class="k">Upload once</span><strong>' + esc(M.label) + " — covers " + list.length + " application" + (list.length > 1 ? "s" : "") + "</strong></div>" +
          checkBtn(false, "Uploaded?", 'data-platform="' + m + '"') + "</div>" +
          "<p>" + esc(steps) + (first && first.deadline ? " Earliest deadline: <strong>" + esc(fmtDay(first.deadline)) + "</strong>." : "") + "</p>" +
          '<div class="btns"><a class="btn ghost small" href="' + esc(M.home) + '" target="_blank" rel="noopener">Open ' + esc(M.label) + ' ↗</a></div>' +
          '<details style="margin-top:0.6rem"><summary>Show the ' + list.length + " application" + (list.length > 1 ? "s" : "") + "</summary>" + listHtml + "</details></div>";
      }
    });
    $("platforms").innerHTML = ph;

    // stats
    const toDo = todo.length + openPlatforms;
    const upcoming = todo.concat(...Object.keys(platformApps).filter((m) => !q.platforms[m]).map((m) => platformApps[m]))
      .filter((a) => a.deadline && dueInfo(a.deadline).n >= 0).sort(byDate)[0];
    const overdue = todo.filter((a) => a.deadline && dueInfo(a.deadline).n < 0).length;
    $("stats").innerHTML =
      '<div><div class="n' + (overdue ? " alert" : "") + '">' + toDo + '</div><div class="l">To do' + (overdue ? " · " + overdue + " past due" : "") + "</div></div>" +
      '<div><div class="n">' + (upcoming ? esc(fmtDay(upcoming.deadline)) : "—") + '</div><div class="l">Next deadline</div></div>' +
      '<div><div class="n">' + (done.length + covered) + '</div><div class="l">Done</div></div>';

    // to-do list
    $("todoAside").textContent = todo.length ? todo.length + " application" + (todo.length > 1 ? "s" : "") : "";
    $("todo").innerHTML = todo.length
      ? todo.map((a) => rowHtml(a, me, { check: true })).join("")
      : '<li class="allclear">' + (apps.length ? "All caught up — nothing left to send" + (openPlatforms ? " apart from the upload above." : ". Thank you!") : "Nothing yet. I'll email you when I submit an application that uses your letter.") + "</li>";

    // groups
    let gh = "";
    if (later.length) {
      gh += '<details class="group"><summary>Nothing to send yet — only if I\'m shortlisted · <b>' + later.length + "</b></summary>" +
        '<ul class="queue">' + later.map((a) => rowHtml(a, me, {})).join("") + "</ul></details>";
    }
    if (done.length) {
      gh += '<details class="group"><summary>Sent · <b>' + done.length + "</b></summary>" +
        '<ul class="queue">' + done.slice().sort(byDate).map((a) => rowHtml(a, me, { check: true, done: true })).join("") + "</ul></details>";
    }
    $("groups").innerHTML = gh;
  }

  /* ---------- events ------------------------------------------- */

  document.addEventListener("click", async (e) => {
    const how = e.target.closest("[data-how]");
    if (how) {
      const id = how.dataset.how, panel = document.getElementById("how-" + id);
      const open = panel.hidden;
      panel.hidden = !open; how.setAttribute("aria-expanded", String(open));
      open ? openHow.add(id) : openHow.delete(id);
      return;
    }
    const cp = e.target.closest("[data-copy]");
    if (cp) { copyText(cp.dataset.copy, cp); return; }
    const d = e.target.closest("[data-done]");
    if (d && current) {
      const on = d.getAttribute("aria-pressed") !== "true";
      d.disabled = true; d.style.opacity = "0.5";
      try { await Backend.setDone(d.dataset.done, current, on); }
      catch (err) { alert(err.message); }
      openHow.delete(d.dataset.done);
      await render();
      return;
    }
    const p = e.target.closest("[data-platform]");
    if (p && current) {
      const on = p.getAttribute("aria-pressed") !== "true";
      p.disabled = true; p.style.opacity = "0.5";
      try { await Backend.setPlatformDone(current, p.dataset.platform, on); }
      catch (err) { alert(err.message); }
      await render();
    }
  });

  Backend.onChange(() => render());

  /* ---------- start -------------------------------------------- */
  const qp = new URLSearchParams(location.search).get("u");
  const start = qp || remembered();
  if (start) signIn(start, !qp); else showSignin("");
})();
