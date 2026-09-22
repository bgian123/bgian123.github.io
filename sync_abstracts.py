#!/usr/bin/env python3
"""Single source of truth for paper abstracts.

Edit abstracts/<key>.txt, then run:  python3 sync_abstracts.py
It rewrites every marked block in the site pages and the CV source:
  HTML:  <!-- abstract:<key> --> ... <!-- /abstract:<key> -->
  LaTeX: % abstract:<key>  ...  % /abstract:<key>
Then recompile the CV (cd cv-src && pdflatex bgres.tex && cp bgres.pdf ../cv.pdf).
"""
import pathlib, re, textwrap

ROOT = pathlib.Path(__file__).parent
TARGETS = ["index.html", "research.html", "cv-src/bgres.tex"]

def to_html(t):
    t = t.replace("&", "&amp;").replace("–", "&ndash;").replace("—", "&mdash;")
    t = t.replace("(N+1)", "<em>(N+1)</em>").replace("−", "&minus;")
    return textwrap.fill(t, 78, initial_indent=" " * 10, subsequent_indent=" " * 10)

def to_tex(t):
    t = t.replace("$", r"\$").replace("%", r"\%").replace("&", r"\&")
    t = t.replace("(N+1)", "$(N+1)$").replace("–", "--").replace("—", "---").replace("−", "$-$")
    return t

for src in sorted((ROOT / "abstracts").glob("*.txt")):
    key, text = src.stem, " ".join(src.read_text().split())
    for rel in TARGETS:
        f = ROOT / rel
        s = f.read_text()
        if rel.endswith(".html"):
            pat = re.compile(rf"(<!-- abstract:{key} -->\n).*?(\n\s*<!-- /abstract:{key} -->)", re.S)
            body = to_html(text)
        else:
            pat = re.compile(rf"(% abstract:{key}\n).*?(\n% /abstract:{key})", re.S)
            body = to_tex(text)
        s2, n = pat.subn(lambda m: m.group(1) + body + m.group(2), s)
        if n:
            f.write_text(s2)
            print(f"{key}: updated {rel} ({n} block{'s' if n > 1 else ''})")
