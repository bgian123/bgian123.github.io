# Job market site — deployment guide

## What's here

- `index.html` — home: photo, bio, JMP, references
- `research.html` — JMP, working papers, work in progress
- `teaching.html` — instructor experience, evals, referee service
- `style.css` — all styling (change `--accent` at the top to recolor the whole site)

## Before going live: fill in the placeholders

Email, office address, titles, and abstracts are already filled in.
Search each HTML file for `[` — every remaining placeholder is bracketed.

1. `photo.jpg` — professional headshot, ~500×620px. Replace the
   `photo-placeholder` div in `index.html` with the `<img>` tag shown in the
   comment next to it.
2. `cv.pdf` — drop your CV in the site root
3. Paper PDFs — create a `papers/` folder: `jmp.pdf`, `jmp-slides.pdf`,
   `auto-tariffs.pdf`, `tv-distance.pdf` (or rename links to match)
4. References/committee names on the home page
5. Teaching terms and evaluation numbers (`teaching.html`), plus `evals.pdf`
   if you post full evaluations
6. TA section on `teaching.html` — fill in or delete
7. Work-in-progress section on `research.html` — fill in or delete

## Deploy to GitHub Pages (free, ~5 minutes)

1. Create a GitHub account if needed, then a new **public** repo named
   `USERNAME.github.io` (using your actual GitHub username). This exact name
   makes the site live at `https://USERNAME.github.io/` with no extra config.
2. From this folder:

   ```bash
   git init
   git add .
   git commit -m "Job market site"
   git branch -M main
   git remote add origin https://github.com/USERNAME/USERNAME.github.io.git
   git push -u origin main
   ```

3. The site is live at `https://USERNAME.github.io/` within a minute or two.
4. To update later: edit files, then `git add . && git commit -m "update" && git push`.

## Optional

- **Custom domain** (e.g., blaizegiangiulio.com, ~$10–15/yr via Namecheap or
  Cloudflare): add a `CNAME` file containing the domain and set DNS per
  GitHub's docs. Not necessary — plenty of successful candidates use
  github.io URLs.
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
