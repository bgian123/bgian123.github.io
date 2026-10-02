# Job market site — deployment guide

## What's here

- `index.html` — home: photo, bio, JMP, references
- `research.html` — JMP, working papers, work in progress
- `teaching.html` — instructor experience, evals, referee service
- `other.html` — side projects (links to the Philly Neighborhood Atlas)
- `philly-atlas/index.html` — the atlas itself, self-contained (built by `interactive_map/scripts/build_data.py` in the philadelphia_map project; copy `docs/index.html` here to update)
- `images/` — screenshots for project cards
- `style.css` — all styling (change `--accent` at the top to recolor the whole site)

## Updating

- CV source: `cv-src/bgres.tex`. After editing, compile with
  `cd cv-src && pdflatex bgres.tex && cp bgres.pdf ../cv.pdf`.
- Paper PDFs linked from the site live in `papers/`.
- Any change to the CV should also be made on the site, and vice versa.

## Hosting

The site is served by GitHub Pages from the `bgian123/bgian123.github.io`
repository at the custom domain **https://blaizegiangiulio.com** (set by the
`CNAME` file in the repo root; the github.io address redirects there).
To publish changes: `git add -A && git commit -m "update" && git push origin main`.

## Optional

- **Analytics**: GoatCounter or Plausible if you want to see when committees
  are reading your JMP (October–December traffic spikes are real).
- Link the site from your email signature, CV header, and EJM/AEA JOE profiles.

## Paper abstracts (single source of truth)

Abstracts shared by the site and the CV live in `abstracts/<key>.txt`
(currently: `chokepoints`). To change one, edit that file and run
`python3 sync_abstracts.py`, then recompile the CV and copy it to `cv.pdf`.
The script rewrites the marked blocks (`<!-- abstract:<key> -->` in HTML,
`% abstract:<key>` in `cv-src/bgres.tex`) so the homepage, research page,
and CV never drift apart.
