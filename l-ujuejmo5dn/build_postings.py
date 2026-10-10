#!/usr/bin/env python3
"""
Build data/postings.js from the AEA JOE XML export.

Usage (from this folder):
    python3 build_postings.py                       # reads listings/joe_full_xml.xml
    python3 build_postings.py path/to/other.xml     # or any newer JOE export

The JOE export has no structured "how to apply" field, so this script reads
each posting's full text and makes a best guess at:
  - method:   how recommendation letters get submitted
              joe | ejm | ajo | interfolio | portal | email | later | unknown
  - letters:  how many letters the posting asks for (0 if none mentioned)
  - letterEmail / applyUrl: where letters or applications go
  - letterText: the sentences in the ad that talk about letters
  - confidence: high | medium | low  (low = a guess; check before sending)
  - teaching: whether the job looks teaching-focused (suggests Mark over Ohyun)

The admin page uses these as pre-filled defaults. Everything is editable there
before it reaches a letter writer, so the guesses never go out unchecked.
"""
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "listings" / "joe_full_xml.xml"
OUT = HERE / "data" / "postings.js"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+|www\.[^\s<>\"')\]]+", re.I)

PLATFORMS = [
    # (method, regex on text)
    ("ejm", re.compile(r"econjobmarket|econ job market|\bEJM\b", re.I)),
    ("ajo", re.compile(r"academicjobsonline|academic ?jobs ?online|\bAJO\b|mathjobs", re.I)),
    ("interfolio", re.compile(r"interfolio", re.I)),
    ("joe", re.compile(r"\bJOE\b|JOE Network|aeaweb\.org/joe|through (the )?AEA", re.I)),
]
PORTAL_RE = re.compile(
    r"workday|myworkdayjobs|peopleadmin|taleo|icims|successfactors|ucrecruit|"
    r"jobs\.[a-z0-9-]+\.(edu|org|com)|careers?\.[a-z0-9-]+\.(edu|org|com)|"
    r"/careers?/|/jobs?/|/postings?/|apply online|online application|"
    r"application portal|applicant portal|recruit",
    re.I,
)
# Letters only requested later (finalists / referees contacted by the employer)
LATER_RE = re.compile(
    r"(finalists?|short-?listed|shortlisted|selected (candidates|applicants)|only (candidates|applicants) (selected|invited))"
    r"[^.]{0,160}(letters?|references?|referees?|reference reports?)|"
    r"(letters?|references?|referees?)[^.]{0,120}(only (for|from) finalists|from finalists|of finalists|of shortlisted)",
    re.I,
)
# Employer system emails referees an upload link once names are entered
CONTACTED_RE = re.compile(
    r"(names?|contact information)[^.]{0,80}(references?|referees?)[^.]{0,160}"
    r"(contacted|receive an? (e-?mail|link)|sent an? (e-?mail|link)|prompted|automatically)|"
    r"(references?|referees?|recommenders?)[^.]{0,80}(will|would) (receive|be sent|be contacted|be emailed|get) "
    r"[^.]{0,80}(e-?mail|link|request|directly)",
    re.I,
)
NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5}
COUNT_RE = re.compile(
    r"\b(one|two|three|four|five|[1-5])\b[^.;\n]{0,40}?\b(letters?|references?|referees?|recommendations?|recommenders?)\b",
    re.I,
)
TEACH_TITLE_RE = re.compile(r"teaching|lecturer|instructor|clinical|of practice|practice professor", re.I)
TEACH_TEXT_RE = re.compile(
    r"liberal arts college|teaching[- ]focused|teaching[- ]intensive|primarily undergraduate|"
    r"emphasis on (excellence in )?teaching|commitment to (excellent |excellence in )?undergraduate teaching",
    re.I,
)
REVIEW_RE = re.compile(
    r"[^.\n]*(review of applications|applications will be reviewed|review will begin|"
    r"first review|priority (consideration|deadline)|full consideration)[^.\n]*[.\n]?",
    re.I,
)


def clean(s):
    if not s:
        return ""
    # the export double-escapes entities (&amp;amp;)
    s = html.unescape(html.unescape(s))
    s = s.replace("​", "").replace("\r", "")
    return s.strip()


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(])|\n+", text)
    return [p.strip() for p in parts if p.strip()]


def is_letter_sentence(s):
    s2 = re.sub(r"cover\s+letters?|letters? of (interest|application|intent|motivation)|motivation letter", "", s, flags=re.I)
    return bool(re.search(r"\bletters?\b|\breferences?\b|\breferees?\b|recommend(ation|er)s?\b", s2, re.I))


def strip_url(u):
    return u.rstrip(".,;:")


def classify(text, section):
    sents = sentences(text)
    letter_sents = [s for s in sents if is_letter_sentence(s)]
    ltxt = " ".join(letter_sents)

    emails_all = sorted(set(EMAIL_RE.findall(text)))
    urls_all = [strip_url(u) for u in URL_RE.findall(text)]
    letter_emails = [e for e in EMAIL_RE.findall(ltxt)]
    letter_urls = [strip_url(u) for u in URL_RE.findall(ltxt)]

    # letter count
    letters = 0
    for m in COUNT_RE.finditer(ltxt):
        n = NUM_WORDS.get(m.group(1).lower())
        if n:
            letters = n  # first stated count wins ("3-5 letters" -> 3)
            break
    if letters == 0 and re.search(r"letters? of (reference|recommendation)|reference letters?|recommendation letters?|letters? from", ltxt, re.I):
        letters = 3  # asked for letters but no count given — 3 is the academic default
    letters_stated = letters > 0
    names_only = bool(re.search(r"(names?|contact (information|details))\s+(and [^.]{0,30})?of\s+(\w+\s+){0,2}(references?|referees?)", ltxt, re.I))

    method, confidence, why = "unknown", "low", ""

    def found(m, c, w):
        nonlocal method, confidence, why
        method, confidence, why = m, c, w

    # 1. Letters explicitly emailed to an address
    if letter_emails and re.search(r"e-?mail|send|sent|submit|forward|directly to", ltxt, re.I):
        found("email", "high", "Ad asks for letters to be emailed")
    # 2. Platform named in a letter sentence
    if method == "unknown":
        for m, rx in PLATFORMS:
            if rx.search(ltxt):
                found(m, "high", "Letter instructions name the platform")
                break
    # 3. Employer contacts referees itself / letters only requested later
    if method == "unknown" and (CONTACTED_RE.search(text) or re.search(r"system-generated|automated e-?mail|automatically (be )?(sent|e-?mailed|contacted)", ltxt, re.I)):
        found("portal", "medium", "Ad says the employer's system emails references an upload link")
    later_hits = [s for s in sents if LATER_RE.search(s) and not re.search(r"associate|full professor|senior|tenured", s, re.I)]
    if method == "unknown" and later_hits:
        found("later", "medium", "Ad says letters are requested later (e.g. finalists only)")
    # 4. Platform named anywhere in the ad (applications go there; letters usually follow)
    if method == "unknown":
        for m, rx in PLATFORMS:
            if rx.search(text):
                found(m, "medium", "Applications go through this platform")
                break
    # 5. Institutional application system
    if method == "unknown" and (PORTAL_RE.search(text) and urls_all):
        found("portal", "low", "Ad links to an online application system")
    # 6. Nothing external: JOE is the default for JOE-listed jobs with no other route
    if method == "unknown":
        app_mail = [s for s in sents if EMAIL_RE.search(s) and re.search(r"(send|e-?mail|submit|forward)[^.]{0,80}(application|materials|cv|curriculum|documents)|(application|materials|documents)[^.]{0,60}(sent|e-?mailed|submitted) (to|via)", s, re.I)
                    and not re.search(r"question|inquir|enquir|further information|more information|contact", s, re.I)]
        if app_mail:
            found("email", "low", "Ad asks for applications by email; letters probably to the same address")
            letter_emails = letter_emails or EMAIL_RE.findall(app_mail[0])[:1]
        elif section and "Nonacademic" not in section:
            found("joe", "low", "No other route given; likely the JOE 'Apply' button")
        elif letters:
            found("joe", "low", "No other route given; likely the JOE 'Apply' button")

    if method == "unknown" and letters == 0:
        found("none", "low", "No letters mentioned in the ad")

    apply_url = ""
    pref = [u for u in urls_all if re.search(r"interfolio|econjobmarket|academicjobsonline|workday|peopleadmin|taleo|icims|careers?|jobs?|apply|posting|recruit", u, re.I)]
    if method == "interfolio":
        pref = [u for u in urls_all if "interfolio" in u.lower()] or pref
    elif method == "ejm":
        pref = [u for u in urls_all if "econjobmarket" in u.lower()] or ["https://econjobmarket.org"]
    elif method == "ajo":
        pref = [u for u in urls_all if "academicjobsonline" in u.lower()] or ["https://academicjobsonline.org"]
    if letter_urls:
        pref = letter_urls + pref
    if pref:
        apply_url = pref[0]
    elif urls_all:
        apply_url = urls_all[0]
    if apply_url.lower().startswith("www."):
        apply_url = "https://" + apply_url

    return {
        "method": method,
        "confidence": confidence,
        "why": why,
        "letters": letters,
        "lettersStated": letters_stated,
        "namesOnly": names_only,
        "letterEmail": letter_emails[0] if letter_emails else "",
        "applyUrl": apply_url,
        "emails": emails_all[:6],
        "letterText": " ".join(letter_sents)[:1400],
    }


def main():
    root = ET.parse(SRC).getroot()
    out = []
    year = (root.find("year").get("joe_year_ID") if root.find("year") is not None else "") or ""
    issue_el = root.find(".//issue")
    issue = (issue_el.get("joe_issue_ID") if issue_el is not None else "") or ""
    joe_prefix = "%s-%02d_" % (year, int(issue)) if year and issue.isdigit() else ""
    for p in root.iter("position"):
        g = lambda tag: clean(p.findtext(tag))
        text = g("jp_full_text")
        section = g("jp_section")
        title = g("jp_title")
        dl = g("jp_application_deadline")[:10]
        locs = []
        for loc in p.iter("location"):
            parts = [clean(loc.findtext(t)).title() for t in ("city", "state")]
            country = clean(loc.findtext("country")).title()
            parts = [x for x in parts if x] + ([country] if country else [])
            if parts:
                locs.append(", ".join(parts))
        info = classify(text, section)
        if info["letters"] == 0 and "Academic" in section:
            info["letters"] = 3  # academic ads that are silent on letters almost always want 3 (via JOE)
        review = REVIEW_RE.search(text)
        out.append({
            "id": p.get("jp_id"),
            "joeUrl": ("https://www.aeaweb.org/joe/listing.php?JOE_ID=" + joe_prefix + p.get("jp_id")) if joe_prefix else "",
            "institution": g("jp_institution"),
            "title": title,
            "department": " · ".join(x for x in (g("jp_division"), g("jp_department")) if x),
            "section": section,
            "deadline": dl,
            "reviewNote": review.group(0).strip()[:220] if review else "",
            "location": " / ".join(dict.fromkeys(locs)),
            "jel": [clean(j.findtext("jc_code")) for j in p.iter("jel_class")],
            "teaching": bool(TEACH_TITLE_RE.search(title) or TEACH_TEXT_RE.search(text)),
            **info,
            "text": text,
        })
    out.sort(key=lambda r: (r["deadline"] or "9999", r["institution"]))
    OUT.parent.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by build_postings.py from %s on %s. Do not edit by hand. */\n" % (SRC.name, stamp))
        f.write("window.JOE_BUILT = %s;\n" % json.dumps(stamp))
        f.write("window.JOE_POSTINGS = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    from collections import Counter
    c = Counter((r["method"], r["confidence"]) for r in out)
    print("Wrote %d postings to %s" % (len(out), OUT))
    for k, v in sorted(c.items()):
        print("  %-11s %-6s %d" % (k[0], k[1], v))


if __name__ == "__main__":
    main()
