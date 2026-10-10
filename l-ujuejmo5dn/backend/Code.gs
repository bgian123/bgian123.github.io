/**
 * Letter Desk backend — Google Apps Script bound to a Google Sheet.
 *
 * The Sheet is the database (tabs: Applications, Writers, Progress, Settings,
 * EmailLog). The writer portal and the Letter Desk call this script's web-app
 * URL. Emails go out from the Google account that deploys it.
 *
 * SETUP (once):
 *   1. Create a new Google Sheet while signed in as blaizegiangiulio@gmail.com.
 *   2. Extensions → Apps Script. Replace everything in Code.gs with this file.
 *   3. Change ADMIN_KEY below to a long password of your own. It never leaves
 *      Google: this copy lives in your Google account, not on GitHub.
 *   4. Run → setup  (approve the permissions it asks for). This creates the tabs.
 *   5. Deploy → New deployment → type "Web app"
 *        Execute as: Me      Who has access: Anyone
 *      Copy the web-app URL into config.js on the site.
 *   After editing this script later: Deploy → Manage deployments → edit →
 *   Version: New version, so the same URL keeps working.
 */

const ADMIN_KEY = "CHANGE-ME-to-a-long-password";

const TABS = {
  Applications: ["id", "joeId", "institution", "title", "department", "location", "section", "deadline", "deadlineNote",
    "method", "url", "email", "subject", "instructions", "note", "adText", "letters", "teaching", "writers",
    "appliedOn", "createdAt", "updatedAt"],
  Writers: ["id", "name", "first", "greet", "email", "role"],
  Progress: ["key", "type", "at"],          // type: done | platform | notified | reminded
  Settings: ["key", "value"],
  EmailLog: ["at", "to", "cc", "subject", "body"],
};

const DEFAULT_WRITERS = [
  { id: "yotov", name: "Yoto V. Yotov", first: "Yoto", greet: "Dear Yoto", email: "yvy23@drexel.edu", role: "core" },
  { id: "syropoulos", name: "Constantinos Syropoulos", first: "Costas", greet: "Dear Costas", email: "cas86@drexel.edu", role: "core" },
  { id: "kwon", name: "Ohyun Kwon", first: "Ohyun", greet: "Dear Ohyun", email: "theekwonomist@gmail.com", role: "research" },
  { id: "stehr", name: "Mark Stehr", first: "Mark", greet: "Dear Mark", email: "ms424@drexel.edu", role: "teaching" },
];
const DEFAULT_SETTINGS = { me: "Blaize Giangiulio", myEmail: "bg654@drexel.edu", portalUrl: "", cc: "bg654@drexel.edu" };
const ONCE_METHODS = ["joe", "ejm", "interfolio"];

/* ---------------- setup ------------------------------------------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  });
  if (readTab_("Writers").length === 0) writeTab_("Writers", DEFAULT_WRITERS);
  if (readTab_("Settings").length === 0) {
    writeTab_("Settings", Object.keys(DEFAULT_SETTINGS).map(function (k) { return { key: k, value: DEFAULT_SETTINGS[k] }; }));
  }
  const s1 = ss.getSheetByName("Sheet1");
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  // touch MailApp so the email permission is granted during setup
  Logger.log("Setup done. Daily email quota left: " + MailApp.getRemainingDailyQuota());
}

/* ---------------- web entry points -------------------------------- */

function doGet() {
  return ContentService.createTextOutput("Letter Desk backend is running.");
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    out = { ok: true, data: handle_(req) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), code: err && err.code };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg, code) { const e = new Error(msg); e.code = code; throw e; }

function isAdmin_(req) {
  if (ADMIN_KEY.indexOf("CHANGE-ME") === 0) fail_("Set ADMIN_KEY in the Apps Script before using the Letter Desk.", "auth");
  return typeof req.key === "string" && req.key.length > 0 && req.key === ADMIN_KEY;
}

function handle_(req) {
  const a = req.action;
  const writerActions = { findWriter: 1, getQueue: 1, setDone: 1, setPlatformDone: 1 };
  if (!writerActions[a] && !isAdmin_(req)) fail_("Wrong password.", "auth");

  const lock = LockService.getScriptLock();
  const writes = !(a === "findWriter" || a === "getQueue" || a === "getAll");
  if (writes) lock.waitLock(20000);
  try {
    const st = load_();
    switch (a) {
      /* ---- writers (identified by email) ---- */
      case "findWriter": {
        const w = writerByEmail_(st, req.email);
        return w ? publicWriter_(w) : null;
      }
      case "getQueue": {
        const w = writerByEmail_(st, req.email) || fail_("Unknown writer", "nowriter");
        const apps = st.apps.filter(function (x) { return x.writers.indexOf(w.id) >= 0; });
        const done = {}, platforms = {};
        apps.forEach(function (x) { const p = st.progress[x.id + "|" + w.id]; if (p) done[x.id] = p.at; });
        Object.keys(st.platforms).forEach(function (k) { const p = k.split("|"); if (p[0] === w.id) platforms[p[1]] = st.platforms[k].at; });
        return { writer: publicWriter_(w), apps: apps, done: done, platforms: platforms,
          settings: { me: st.settings.me, myEmail: st.settings.myEmail } };
      }
      case "setDone": {
        const w = writerByEmail_(st, req.email) || fail_("Unknown writer", "nowriter");
        const app = st.apps.filter(function (x) { return x.id === req.appId; })[0];
        if (!app || app.writers.indexOf(w.id) < 0) fail_("That application isn't on your list.");
        setProgress_(app.id + "|" + w.id, "done", !!req.val);
        return true;
      }
      case "setPlatformDone": {
        const w = writerByEmail_(st, req.email) || fail_("Unknown writer", "nowriter");
        if (ONCE_METHODS.indexOf(req.method) < 0) fail_("Unknown platform");
        setProgress_(w.id + "|" + req.method, "platform", !!req.val);
        return true;
      }

      /* ---- admin ---- */
      case "getAll": return st;
      case "saveApp": {
        const app = req.app || fail_("No application");
        if (!app.id) fail_("Application has no id");
        const now = new Date().toISOString();
        app.updatedAt = now;
        const i = st.apps.map(function (x) { return x.id; }).indexOf(app.id);
        if (i >= 0) { app.createdAt = st.apps[i].createdAt || now; st.apps[i] = app; } else { app.createdAt = now; st.apps.push(app); }
        writeTab_("Applications", st.apps.map(appRow_));
        return app;
      }
      case "deleteApp": {
        st.apps = st.apps.filter(function (x) { return x.id !== req.id; });
        writeTab_("Applications", st.apps.map(appRow_));
        const rows = readTab_("Progress").filter(function (r) { return r.type === "platform" || r.key.indexOf(req.id + "|") !== 0; });
        writeTab_("Progress", rows);
        return true;
      }
      case "saveWriters": {
        const list = (req.list || []).map(function (w) {
          return { id: String(w.id || ""), name: String(w.name || ""), first: String(w.first || ""), greet: String(w.greet || ""),
            email: String(w.email || "").trim(), role: String(w.role || "extra") };
        }).filter(function (w) { return w.id; });
        writeTab_("Writers", list);
        return true;
      }
      case "saveSettings": {
        const patch = req.patch || {};
        delete patch.passHash;
        Object.keys(patch).forEach(function (k) { st.settings[k] = String(patch[k] == null ? "" : patch[k]); });
        writeTab_("Settings", Object.keys(st.settings).map(function (k) { return { key: k, value: st.settings[k] }; }));
        return true;
      }
      case "markNotified":
      case "markReminded": {
        const type = a === "markNotified" ? "notified" : "reminded";
        setProgressMany_((req.appIds || []).map(function (id) { return id + "|" + req.writerId; }), type, true);
        return true;
      }
      case "sendEmail": {
        const to = String(req.to || "").trim();
        if (!st.writers.some(function (w) { return norm_(w.email) === norm_(to); })) fail_("Emails can only go to your letter writers.");
        const cc = st.settings.cc || "";
        const opts = { to: to, subject: String(req.subject || ""), body: String(req.body || ""), name: st.settings.me || "Blaize Giangiulio" };
        if (cc) opts.cc = cc;
        if (st.settings.myEmail) opts.replyTo = st.settings.myEmail;
        MailApp.sendEmail(opts);
        appendRow_("EmailLog", { at: new Date().toISOString(), to: to, cc: cc, subject: opts.subject, body: opts.body });
        return { remaining: MailApp.getRemainingDailyQuota() };
      }
      case "replaceAll": {
        const s = req.state || fail_("No data");
        writeTab_("Applications", (s.apps || []).map(appRow_));
        writeTab_("Writers", s.writers || []);
        const rows = [];
        Object.keys(s.progress || {}).forEach(function (k) { rows.push({ key: k, type: "done", at: s.progress[k].at }); });
        Object.keys(s.platforms || {}).forEach(function (k) { rows.push({ key: k, type: "platform", at: s.platforms[k].at }); });
        Object.keys(s.notified || {}).forEach(function (k) { rows.push({ key: k, type: "notified", at: s.notified[k] }); });
        Object.keys(s.reminded || {}).forEach(function (k) { rows.push({ key: k, type: "reminded", at: s.reminded[k] }); });
        writeTab_("Progress", rows);
        const set = s.settings || {}; delete set.passHash;
        writeTab_("Settings", Object.keys(set).map(function (k) { return { key: k, value: set[k] }; }));
        return true;
      }
      case "reset": {
        writeTab_("Applications", []); writeTab_("Progress", []);
        return true;
      }
      default: fail_("Unknown action: " + a);
    }
  } finally {
    if (writes) lock.releaseLock();
  }
}

/* ---------------- state <-> sheet --------------------------------- */

function load_() {
  const st = { version: 1, writers: [], apps: [], progress: {}, platforms: {}, notified: {}, reminded: {}, settings: {} };
  st.writers = readTab_("Writers");
  st.apps = readTab_("Applications").map(function (r) {
    r.letters = Number(r.letters) || 0;
    r.teaching = r.teaching === "true" || r.teaching === "TRUE";
    r.writers = r.writers ? String(r.writers).split(",").map(function (x) { return x.trim(); }).filter(String) : [];
    return r;
  });
  readTab_("Progress").forEach(function (r) {
    if (r.type === "done") st.progress[r.key] = { at: r.at };
    else if (r.type === "platform") st.platforms[r.key] = { at: r.at };
    else if (r.type === "notified") st.notified[r.key] = r.at;
    else if (r.type === "reminded") st.reminded[r.key] = r.at;
  });
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { st.settings[k] = DEFAULT_SETTINGS[k]; });
  readTab_("Settings").forEach(function (r) { st.settings[r.key] = r.value; });
  return st;
}

function appRow_(app) {
  const r = {};
  TABS.Applications.forEach(function (k) { r[k] = app[k]; });
  r.writers = (app.writers || []).join(",");
  r.teaching = app.teaching ? "true" : "false";
  return r;
}

function setProgress_(key, type, on) { setProgressMany_([key], type, on); }
function setProgressMany_(keys, type, on) {
  const set = {}; keys.forEach(function (k) { set[k] = 1; });
  const rows = readTab_("Progress").filter(function (r) { return !(set[r.key] && r.type === type); });
  const now = new Date().toISOString();
  if (on) keys.forEach(function (k) { rows.push({ key: k, type: type, at: now }); });
  writeTab_("Progress", rows);
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) fail_("Missing tab '" + name + "'. Run setup() in the Apps Script editor.");
  return sh;
}

function readTab_(name) {
  const sh = sheet_(name);
  const n = sh.getLastRow();
  if (n < 2) return [];
  const cols = TABS[name];
  const vals = sh.getRange(2, 1, n - 1, cols.length).getDisplayValues();
  return vals.filter(function (row) { return row.some(function (v) { return v !== ""; }); }).map(function (row) {
    const o = {};
    cols.forEach(function (c, i) { o[c] = row[i]; });
    return o;
  });
}

function writeTab_(name, rows) {
  const sh = sheet_(name);
  const cols = TABS[name];
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (!rows.length) return;
  const vals = rows.map(function (o) { return cols.map(function (c) { return o[c] == null ? "" : String(o[c]); }); });
  const rng = sh.getRange(2, 1, vals.length, cols.length);
  rng.setNumberFormat("@");   // keep dates and ids as plain text
  rng.setValues(vals);
}

function appendRow_(name, o) {
  const sh = sheet_(name);
  const row = TABS[name].map(function (c) { return o[c] == null ? "" : String(o[c]); });
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat("@").setValues([row]);
}

function norm_(e) { return String(e || "").trim().toLowerCase(); }
function writerByEmail_(st, email) {
  const e = norm_(email);
  if (!e) return null;
  return st.writers.filter(function (w) { return norm_(w.email) === e; })[0] || null;
}
function publicWriter_(w) { return { id: w.id, name: w.name, first: w.first, email: w.email }; }
