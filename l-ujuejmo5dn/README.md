# Letter portal

A private page for my four letter writers, plus a password page for me.
Not linked from the main site, and every page carries `noindex`.

## Files

| File | What it is |
|---|---|
| `index.html` + `writer.js` | Writer portal. Sign in with email → list of letters to send, soonest first, with "How to submit" steps and a tick box for each. |
| `admin.html` + `admin.js` | Letter Desk (my page). Test-mode password: `letters`. Live password: the ADMIN_KEY you set in the Apps Script. |
| `config.js` | Empty = test mode. Paste the Apps Script URL here to go live. |
| `backend/Code.gs` | The Google Apps Script backend (paste into the Sheet's script editor). |
| `common.js` | Shared logic: storage, submission-method instructions, writer-assignment rule, email drafts. |
| `portal.css` | Same type and colours as the main site (standalone copy). |
| `build_postings.py` | Reads the JOE XML export and writes `data/postings.js`. |
| `data/postings.js` | 486 parsed JOE postings (generated; don't edit). |
| `listings/joe_full_xml.xml` | The JOE export. |

## Testing

Double-click `admin.html` (or run `python3 -m http.server` here and open
`http://localhost:8000/admin.html`). Data tab → **Load demo applications** to get
a spread of methods. Then open `index.html` in the same browser and sign in as
any writer (or use **View as** on the Writers tab).

In test mode everything is stored in the browser's localStorage, so the admin
and writer pages only share data within one browser. Export JSON from the Data
tab to keep a copy.

## How letters are routed

`build_postings.py` reads each ad's text and guesses where letters go:

- **AEA JOE / EconJobMarket / Interfolio (your Dossier)**: the writer uploads once, and that letter covers every application on that platform. The writer gets one "upload once" card instead of one row per application.
- **AcademicJobsOnline / employer portal**: the system emails the writer a link for each position, so each one gets its own row and tick box.
- **Email**: the address and a ready-made subject line, with copy buttons and a compose button.
- **If shortlisted**: nothing to do now. These appear in a collapsed "heads-up" group.

Guesses marked `?` are low confidence. Each application is checked and edited
in the editor before any writer sees it.

Default writers: 1 letter → Yoto; 2 → + Costas; 3 → + Ohyun, or Mark if
the job is teaching-focused; 4 → both.

## Refreshing JOE postings

Save a new JOE XML export into `listings/` and run `python3 build_postings.py`.
Applications already saved aren't affected; they keep their own copy of the details.

## Going live (Google Sheet backend)

The live data sits in a Google Sheet in blaizegiangiulio@gmail.com, read and
written by a Google Apps Script (`backend/Code.gs`). Emails to writers go out
from that Gmail with bg654@drexel.edu on cc, and replies go to the Drexel address.

1. Signed in as blaizegiangiulio@gmail.com, create a new Google Sheet (name it e.g. "Letter Desk").
2. **Extensions → Apps Script.** Delete what's in `Code.gs` and paste in all of `backend/Code.gs`.
3. On the line `const ADMIN_KEY = "CHANGE-ME-..."`, put a long password of your own.
   This is the Letter Desk password from now on. It stays in your Google account,
   and the copy on GitHub keeps the placeholder.
4. Pick `setup` in the function menu, click **Run**, and approve the permissions
   (Sheets + send email as you). This creates the tabs and the four writers.
5. **Deploy → New deployment →** gear icon → **Web app**.
   Execute as **Me**, Who has access **Anyone**. Click Deploy and copy the URL
   (ends in `/exec`).
6. Paste that URL into `config.js` (`apiUrl: "https://script.google.com/macros/s/…/exec"`).
7. Open `admin.html`, enter the password from step 3. Data tab → set
   **Writer portal address** to `https://blaizegiangiulio.com/l-ujuejmo5dn/`.
8. Optional: export JSON from the test-mode Letter Desk first, then Import it in live mode
   to carry over anything you entered while testing.

Editing the script later: **Deploy → Manage deployments → ✏️ → Version: New version**.
That keeps the same URL.

**Who can see what.** "Anyone" access means the web app answers anyone who
has its URL. Admin actions (all data, saving, emails) need the password, which the
server checks. Writer actions only return the list for the email address given.
This is the "no passwords" trade-off we chose: someone who knows a writer's
address and finds this page could see that writer's list. The Sheet itself
stays private to your Google account.

**Interfolio.** Interfolio applications count as "upload once" (your
Interfolio Dossier) and never trigger an email from the Letter Desk, because Interfolio
sends its own request. JOE and EJM applications stop triggering emails once a
writer has ticked that upload.

## Publishing

The folder name `l-ujuejmo5dn` is deliberately unguessable. Don't link it from
the site, and don't list it in `robots.txt`, because that would advertise it. Every page
has `noindex`. The GitHub repo is public, so this code is visible there, but
no application data is: that only lives in the Sheet.
