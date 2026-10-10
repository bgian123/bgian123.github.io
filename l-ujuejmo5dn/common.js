/* ---------------------------------------------------------------
   Letter portal — shared code for the writer page and the admin page.

   TEST MODE: all data lives in this browser's localStorage, so the
   admin page and the writer page see the same data only when opened
   in the same browser. The Backend object below is the single place
   that touches storage; swapping it for a hosted backend (e.g. a
   Google Apps Script web app) leaves both pages unchanged.
   --------------------------------------------------------------- */

(function () {
  "use strict";

  const KEY = "letterPortal.v1";

  /* ---------- defaults ----------------------------------------- */

  const DEFAULT_WRITERS = [
    { id: "yotov", name: "Yoto V. Yotov", first: "Yoto", greet: "Dear Yoto", email: "yvy23@drexel.edu", role: "core" },
    { id: "syropoulos", name: "Constantinos Syropoulos", first: "Costas", greet: "Dear Costas", email: "cas86@drexel.edu", role: "core" },
    { id: "kwon", name: "Ohyun Kwon", first: "Ohyun", greet: "Dear Ohyun", email: "theekwonomist@gmail.com", role: "research" },
    { id: "stehr", name: "Mark Stehr", first: "Mark", greet: "Dear Mark", email: "ms424@drexel.edu", role: "teaching" },
  ];

  const ROLE_LABEL = {
    core: "Every application (1st/2nd letter)",
    research: "3rd letter, research jobs",
    teaching: "3rd letter, teaching jobs",
    extra: "Only when picked by hand",
  };

  function blankState() {
    return {
      version: 1,
      writers: JSON.parse(JSON.stringify(DEFAULT_WRITERS)),
      apps: [],
      progress: {},   // "appId|writerId" -> { at }
      platforms: {},  // "writerId|joe"   -> { at }
      notified: {},   // "appId|writerId" -> iso date
      reminded: {},   // "appId|writerId" -> iso date of last reminder
      settings: {
        me: "Blaize Giangiulio",
        myEmail: "bg654@drexel.edu",
        portalUrl: "",
        cc: "bg654@drexel.edu",   // copied on every email to writers
        // SHA-256 of the test password "letters". Change it on the Data tab.
        passHash: "7ad8dbe5dbed0dcda5e2fa713de5ddb5b6db23d8b7f4fc0ed2650b5b071107c7",
      },
    };
  }

  /* ---------- storage backend (test mode) ---------------------- */

  function readState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    if (!s || s.version !== 1) s = blankState();
    const b = blankState();
    s.writers = s.writers && s.writers.length ? s.writers : b.writers;
    // carry corrected default addresses into data saved before the fix
    s.writers.forEach((w) => {
      if (w.id === "yotov" && w.email === "yotov@drexel.edu") w.email = "yvy23@drexel.edu";
      if (w.id === "stehr" && !w.email) w.email = "ms424@drexel.edu";
    });
    s.apps = s.apps || [];
    s.progress = s.progress || {};
    s.platforms = s.platforms || {};
    s.notified = s.notified || {};
    s.reminded = s.reminded || {};
    s.settings = Object.assign(b.settings, s.settings || {});
    return s;
  }
  function writeState(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e) { alert("Could not save (browser storage is blocked or full)."); }
  }

  const wid = (w) => (typeof w === "string" ? w : w && w.id);

  const LocalBackend = {
    mode: "test",
    setKey() {}, hasKey() { return true; },
    async getAll() { return readState(); },
    async findWriter(email) {
      const e = norm(email);
      return readState().writers.find((w) => norm(w.email) === e && e) || null;
    },
    async getQueue(w) {
      const writerId = wid(w);
      const s = readState();
      const writer = s.writers.find((w) => w.id === writerId);
      const apps = s.apps.filter((a) => (a.writers || []).includes(writerId));
      const done = {}, platforms = {};
      apps.forEach((a) => { const p = s.progress[a.id + "|" + writerId]; if (p) done[a.id] = p.at; });
      Object.keys(s.platforms).forEach((k) => { const [w, m] = k.split("|"); if (w === writerId) platforms[m] = s.platforms[k].at; });
      return { writer, apps, done, platforms, settings: { me: s.settings.me, myEmail: s.settings.myEmail } };
    },
    async setDone(appId, w, val) {
      const s = readState(); const k = appId + "|" + wid(w);
      if (val) s.progress[k] = { at: new Date().toISOString() }; else delete s.progress[k];
      writeState(s);
    },
    async setPlatformDone(w, method, val) {
      const s = readState(); const k = wid(w) + "|" + method;
      if (val) s.platforms[k] = { at: new Date().toISOString() }; else delete s.platforms[k];
      writeState(s);
    },
    async saveApp(app) {
      const s = readState();
      app.updatedAt = new Date().toISOString();
      const i = s.apps.findIndex((a) => a.id === app.id);
      if (i >= 0) s.apps[i] = app; else { app.createdAt = app.updatedAt; s.apps.push(app); }
      writeState(s); return app;
    },
    async deleteApp(id) {
      const s = readState();
      s.apps = s.apps.filter((a) => a.id !== id);
      for (const k of Object.keys(s.progress)) if (k.startsWith(id + "|")) delete s.progress[k];
      for (const k of Object.keys(s.notified)) if (k.startsWith(id + "|")) delete s.notified[k];
      for (const k of Object.keys(s.reminded)) if (k.startsWith(id + "|")) delete s.reminded[k];
      writeState(s);
    },
    async saveWriters(list) { const s = readState(); s.writers = list; writeState(s); },
    async saveSettings(patch) { const s = readState(); Object.assign(s.settings, patch); writeState(s); },
    async markNotified(writerId, appIds) {
      const s = readState(); const t = new Date().toISOString();
      appIds.forEach((id) => { s.notified[id + "|" + writerId] = t; });
      writeState(s);
    },
    async markReminded(writerId, appIds) {
      const s = readState(); const t = new Date().toISOString();
      appIds.forEach((id) => { s.reminded[id + "|" + writerId] = t; });
      writeState(s);
    },
    async replaceAll(obj) { writeState(obj); },
    async reset() { localStorage.removeItem(KEY); },
    async sendEmail() { throw new Error("Sending needs the live backend"); },
    onChange(fn) { window.addEventListener("storage", (e) => { if (e.key === KEY) fn(); }); },
  };

  /* ---------- live backend (Google Sheet via Apps Script) ------
     Turned on by putting the web-app URL in config.js. Writers are
     identified by email; admin calls carry the key typed at the gate. */

  const CFG = window.LP_CONFIG || {};
  const KEY_SLOT = "letterPortal.key";
  let adminKey = "";
  try { adminKey = sessionStorage.getItem(KEY_SLOT) || ""; } catch (e) {}

  async function call(action, payload) {
    let r;
    try {
      r = await fetch(CFG.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },  // keeps it a "simple" request (no CORS preflight)
        body: JSON.stringify(Object.assign({ action, key: adminKey }, payload || {})),
        redirect: "follow",
      });
    } catch (e) { throw new Error("Can't reach the letter server. Check your connection and try again."); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error("The letter server sent an unexpected reply."); }
    if (!j.ok) { const err = new Error(j.error || "Server error"); err.code = j.code; throw err; }
    return j.data;
  }

  const RemoteBackend = {
    mode: "live",
    setKey(k) { adminKey = k || ""; try { k ? sessionStorage.setItem(KEY_SLOT, k) : sessionStorage.removeItem(KEY_SLOT); } catch (e) {} },
    hasKey() { return !!adminKey; },
    getAll() { return call("getAll"); },
    findWriter(email) { return call("findWriter", { email }); },
    getQueue(w) { return call("getQueue", { email: w.email }); },
    setDone(appId, w, val) { return call("setDone", { email: w.email, appId, val: !!val }); },
    setPlatformDone(w, method, val) { return call("setPlatformDone", { email: w.email, method, val: !!val }); },
    saveApp(app) { return call("saveApp", { app }); },
    deleteApp(id) { return call("deleteApp", { id }); },
    saveWriters(list) { return call("saveWriters", { list }); },
    saveSettings(patch) { return call("saveSettings", { patch }); },
    markNotified(writerId, appIds) { return call("markNotified", { writerId, appIds }); },
    markReminded(writerId, appIds) { return call("markReminded", { writerId, appIds }); },
    replaceAll(state) { return call("replaceAll", { state }); },
    reset() { return call("reset"); },
    sendEmail(msg) { return call("sendEmail", msg); },
    onChange() {},
  };

  const Backend = CFG.apiUrl ? RemoteBackend : LocalBackend;

  /* ---------- how letters get submitted ------------------------ */

  // kind: "once"  -> one upload on the platform covers every application there
  //       "each"  -> the writer does something for this specific application
  //       "later" -> nothing to do now
  //       "none"  -> no letters
  const METHODS = {
    joe: { label: "AEA JOE", kind: "once", platform: "the AEA JOE Network", home: "https://www.aeaweb.org/joe/" },
    ejm: { label: "EconJobMarket", kind: "once", platform: "EconJobMarket", home: "https://econjobmarket.org/" },
    ajo: { label: "AcademicJobsOnline", kind: "each", platform: "AcademicJobsOnline", home: "https://academicjobsonline.org/" },
    interfolio: { label: "Interfolio", kind: "once", platform: "my Interfolio Dossier", home: "https://account.interfolio.com/", silent: true },
    portal: { label: "Employer portal", kind: "each" },
    email: { label: "Email", kind: "each" },
    other: { label: "See note", kind: "each" },
    later: { label: "If shortlisted", kind: "later" },
    none: { label: "No letters", kind: "none" },
  };
  METHODS.joe.onceText = "Use the request email from the AEA JOE Network, or sign in to JOE as a letter writer, and upload one PDF. I then attach it to each JOE application myself.";
  METHODS.ejm.onceText = "Use EconJobMarket's request email, or sign in at econjobmarket.org as a recommender, and upload one PDF. EJM delivers it to every position I apply to there.";
  METHODS.interfolio.onceText = "Use the request email from Interfolio to upload one PDF to my Interfolio Dossier. No account is needed. I then send it to each employer from my dossier myself.";
  const METHOD_ORDER = ["joe", "ejm", "ajo", "interfolio", "portal", "email", "other", "later", "none"];

  function subjectFor(app, me) {
    return app.subject || ("Letter of recommendation for " + (me || "Blaize Giangiulio") + " — " + app.title + ", " + app.institution);
  }

  // Steps for the writer, as an array of HTML strings (already escaped).
  function stepsFor(app, me) {
    const m = app.method, inst = esc(app.institution);
    const M = METHODS[m] || METHODS.other;
    const s = [];
    if (m === "joe") {
      s.push("Nothing to do for this one beyond your single JOE upload — I attach your letter to each JOE application myself.");
      s.push("If you haven't uploaded yet: use the request email from the AEA JOE Network, or sign in to JOE as a letter writer, and upload one PDF.");
    } else if (m === "ejm") {
      s.push("Covered by your single EconJobMarket upload — EJM delivers your letter to every position I apply to there.");
      s.push("If you haven't uploaded yet: use EJM's request email, or sign in at econjobmarket.org as a recommender, and upload one PDF.");
    } else if (m === "ajo") {
      s.push("AcademicJobsOnline sends you a separate request for this position. Look for an email from AcademicJobsOnline that names " + inst + " (check spam).");
      s.push("Open the link in that email and upload your letter as a PDF.");
    } else if (m === "interfolio") {
      s.push("Covered by your single upload to my Interfolio Dossier — I send your letter to " + inst + " from the dossier myself.");
      s.push("If you haven't uploaded yet: use the request email from Interfolio and upload one PDF. No account is needed.");
    } else if (m === "portal") {
      s.push(inst + "'s application system emails you directly with an upload link. Look for an automated message that mentions me (check spam).");
      s.push("Open the link and upload your letter as a PDF. You don't need to create an account on the employer's site.");
    } else if (m === "email") {
      s.push("Email your letter as a PDF attachment to <strong>" + esc(app.email || "(address missing — ask me)") + "</strong>.");
      s.push("Use this subject line so it's filed with my application: <em>" + esc(subjectFor(app, me)) + "</em>");
    } else if (m === "later") {
      s.push("Nothing to send yet. " + inst + " asks for letters only if I'm shortlisted. If they contact you, I'll move this into your to-do list.");
    } else if (m === "none") {
      s.push("This application doesn't need a letter.");
    }
    return { steps: s, label: M.label };
  }

  /* ---------- assignment rule ---------------------------------- */
  // 1 letter: Yoto. 2: + Costas. 3: + Ohyun, or Mark if teaching. 4: both.
  function suggestWriters(writers, n, teaching) {
    const core = writers.filter((w) => w.role === "core");
    const research = writers.filter((w) => w.role === "research");
    const teach = writers.filter((w) => w.role === "teaching");
    const order = core.concat(teaching ? teach.concat(research) : research.concat(teach));
    return order.slice(0, Math.max(0, n | 0)).map((w) => w.id);
  }

  /* ---------- dates -------------------------------------------- */

  function parseDay(d) { if (!d) return null; const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); }
  function today() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function daysUntil(d) { const x = parseDay(d); return x ? Math.round((x - today()) / 864e5) : null; }
  function fmtDay(d, withYear) {
    const x = parseDay(d); if (!x) return "No deadline";
    return x.toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
  }
  function dueInfo(d) {
    const n = daysUntil(d);
    if (n === null) return { cls: "none", text: "No deadline listed", n: 1e9 };
    if (n < 0) return { cls: "past", text: (-n) + (n === -1 ? " day" : " days") + " ago", n };
    if (n === 0) return { cls: "soon", text: "Due today", n };
    if (n <= 7) return { cls: "soon", text: "in " + n + (n === 1 ? " day" : " days"), n };
    if (n <= 21) return { cls: "near", text: "in " + n + " days", n };
    return { cls: "far", text: "in " + Math.round(n / 7) + " weeks", n };
  }

  /* ---------- emails to writers -------------------------------- */

  function bullet(app, me) {
    const due = app.deadline ? fmtDay(app.deadline) : "no deadline";
    let how = "";
    const m = app.method;
    if (m === "email") how = "email PDF to " + (app.email || "?") + ' (subject: "' + subjectFor(app, me) + '")';
    else if (m === "portal") how = "watch for an upload link from " + app.institution + "'s system";
    else if (m === "ajo") how = "upload via the AcademicJobsOnline request email";
    else if (m === "other") how = "see the portal for instructions";
    return "  • " + due + " — " + app.institution + ", " + app.title + (how ? "\n      → " + how : "");
  }

  function composeEmail(state, writer, newApps, opts) {
    opts = opts || {};
    const me = state.settings.me || "Blaize";
    const meFirst = me.split(" ")[0];
    const done = (a) => state.progress[a.id + "|" + writer.id];
    const platDone = (m) => state.platforms[writer.id + "|" + m];
    const act = newApps.filter((a) => (METHODS[a.method] || {}).kind === "each");
    const once = newApps.filter((a) => (METHODS[a.method] || {}).kind === "once");
    const later = newApps.filter((a) => (METHODS[a.method] || {}).kind === "later");
    const byDate = (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999");
    act.sort(byDate); once.sort(byDate); later.sort(byDate);

    const L = [];
    L.push((writer.greet || ("Dear " + writer.first)) + ",");
    L.push("");
    const n = newApps.length;
    L.push(n === 1
      ? "I've submitted one more application that uses your letter."
      : "I've submitted " + n + " more applications that use your letter.");
    L.push("");
    if (act.length) {
      L.push("NEEDS A LETTER FROM YOU (" + act.length + ")");
      act.forEach((a) => L.push(bullet(a, me)));
      L.push("");
    }
    if (once.length) {
      const plats = [...new Set(once.map((a) => a.method))];
      plats.forEach((p) => {
        const list = once.filter((a) => a.method === p);
        const M = METHODS[p];
        L.push(platDone(p)
          ? "ALREADY COVERED BY YOUR " + M.label.toUpperCase() + " UPLOAD — nothing to do (" + list.length + ")"
          : "VIA " + M.label.toUpperCase() + " — one upload covers all of these (" + list.length + ")");
        list.forEach((a) => L.push(bullet(a, me)));
        L.push("");
      });
    }
    if (later.length) {
      L.push("NOTHING TO SEND YET — letters only if I'm shortlisted (" + later.length + ")");
      later.forEach((a) => L.push(bullet(a, me)));
      L.push("");
    }
    if (opts.reminders && opts.reminders.length) {
      L.push("STILL OPEN AND DUE SOON");
      opts.reminders.sort(byDate).forEach((a) => L.push(bullet(a, me)));
      L.push("");
    }
    const url = state.settings.portalUrl;
    if (url) {
      L.push("Step-by-step instructions for each one, and a box to tick when it's sent, are on your page:");
      L.push(url + (url.includes("?") ? "&" : "?") + "u=" + encodeURIComponent(writer.email));
      L.push("");
    }
    L.push("Thank you again for writing on my behalf.");
    L.push("");
    L.push("Best,");
    L.push(meFirst);
    const subj = n === 1
      ? "Letter request: " + newApps[0].institution + (newApps[0].deadline ? " (due " + fmtDay(newApps[0].deadline) + ")" : "")
      : n + " new letter requests" + (act.length ? " — first due " + fmtDay(act[0].deadline || (once[0] || {}).deadline) : "");
    return { to: writer.email, subject: subj, body: L.join("\n") };
  }

  /* ---------- small helpers ------------------------------------ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function norm(e) { return String(e || "").trim().toLowerCase(); }
  function uid() { return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function safeUrl(u) {
    u = String(u || "").trim(); if (!u) return "";
    if (/^www\./i.test(u)) u = "https://" + u;
    return /^https?:\/\//i.test(u) ? u : "";
  }
  async function copyText(t, btn) {
    try { await navigator.clipboard.writeText(t); }
    catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e2) {} ta.remove(); }
    if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = o), 1200); }
  }
  function mailto(to, subject, body) {
    return "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(subject || "") + (body ? "&body=" + encodeURIComponent(body) : "");
  }
  function gmail(to, subject, body) {
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(to || "") + "&su=" + encodeURIComponent(subject || "") + "&body=" + encodeURIComponent(body || "");
  }

  // Minimal SHA-256 (hex) so the password gate also works from file://
  async function sha256(str) {
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const K = [], H = [];
    let n = 2, c = 0;
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
    while (c < 64) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; }
      if (p) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); K[c] = frac(Math.pow(n, 1 / 3)); c++; } n++; }
    const bytes = [...new TextEncoder().encode(str)], l = bytes.length * 8;
    bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < bytes.length; o += 64) {
      const w = [];
      for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, cc, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  window.LP = {
    Backend, METHODS, METHOD_ORDER, ROLE_LABEL, DEFAULT_WRITERS,
    stepsFor, subjectFor, suggestWriters, composeEmail,
    parseDay, daysUntil, fmtDay, dueInfo,
    esc, norm, uid, safeUrl, copyText, mailto, gmail, sha256, blankState,
  };
})();
