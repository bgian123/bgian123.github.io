#!/usr/bin/env python3
"""
Build backend/Portal.html: the writer page as one self-contained file for the
Apps Script to serve at its script.google.com address (Michele's page, since
Drexel's network blocks blaizegiangiulio.com).

Run after changing index.html, portal.css, common.js or writer.js:
    python3 build_portal_gs.py
then paste backend/Portal.html into the Apps Script's Portal.html file and
deploy a new version.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
html = (HERE / "index.html").read_text(encoding="utf-8")
css = (HERE / "portal.css").read_text(encoding="utf-8")
js_common = (HERE / "common.js").read_text(encoding="utf-8")
js_writer = (HERE / "writer.js").read_text(encoding="utf-8")

for js in (js_common, js_writer):
    assert "</script" not in js.lower(), "script text would end the inline <script> early"

# links open outside the Apps Script frame
html = html.replace("<head>", '<head>\n<base target="_top">', 1)
html = re.sub(r'<link rel="stylesheet" href="portal\.css[^"]*">', lambda m: "<style>\n" + css + "\n</style>", html)
html = re.sub(r'<script src="config\.js[^"]*"></script>',
              lambda m: '<script>window.LP_CONFIG = { apiUrl: "apps-script" };</script>', html)
html = re.sub(r'<script src="common\.js[^"]*"></script>', lambda m: "<script>\n" + js_common + "\n</script>", html)
html = re.sub(r'<script src="writer\.js[^"]*"></script>', lambda m: "<script>\n" + js_writer + "\n</script>", html)
assert 'src="' not in html and 'href="portal.css' not in html, "an external file was not inlined"

out = HERE / "backend" / "Portal.html"
out.write_text(html, encoding="utf-8")
print("Wrote", out, "(%d KB)" % (len(html) // 1024))
