"""Teaching-evaluation dot plots for bgian123.github.io (teaching page).
Source: Drexel LeBow course evaluation reports (Fall 2024, Fall 2025, Spring 2026)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.lines import Line2D

NAVY, INK, MUTED, RULE = "#07294D", "#1c1c1c", "#5a5a5a", "#d9d9d4"
DEPT, COLL, GOLD = "#7A8089", "#B3B8BF", "#FFC600"
SERIF, SANS = "Caladea", "FreeSans"

EVALS = [
 dict(key="econ201-fall2025", course="ECON 201 · Principles of Microeconomics", term="Fall 2025",
      resp="40 of 46 students responded (87%)", scale=5, xlim=(3.6, 5.0),
      overall=("Overall course quality", 4.60, 3.91, 4.19),
      items=[("Clear criteria for success", 4.93, 4.37, 4.48),
             ("Helpful and responsive to students", 4.88, 4.30, 4.48),
             ("Explained material clearly", 4.85, 4.23, 4.42),
             ("Increased subject knowledge", 4.75, 4.31, 4.44),
             ("Real-world relevance", 4.70, 4.40, 4.51),
             ("Welcoming, inclusive environment", 4.70, 4.28, 4.45),
             ("Fostered active learning", 4.45, 4.09, 4.42)]),
 dict(key="econ301-spring2026", course="ECON 301 · Intermediate Microeconomics", term="Spring 2026",
      resp="19 of 48 students responded (40%)", scale=5, xlim=(3.6, 5.0),
      overall=("Overall course quality", 4.32, 3.81, 4.14),
      items=[("Clear criteria for success", 4.68, 4.26, 4.44),
             ("Helpful and responsive to students", 4.68, 4.16, 4.42),
             ("Explained material clearly", 4.63, 4.09, 4.36),
             ("Increased subject knowledge", 4.63, 4.15, 4.40),
             ("Welcoming, inclusive environment", 4.53, 4.17, 4.40),
             ("Real-world relevance", 4.37, 4.28, 4.46),
             ("Fostered active learning", 4.21, 4.00, 4.38)]),
 dict(key="econ201-fall2024", course="ECON 201 · Principles of Microeconomics", term="Fall 2024",
      resp="38 of 39 students responded (97%)", scale=4, xlim=(3.0, 4.0),
      overall=("Overall teaching effectiveness", 3.63, 3.29, 3.50),
      items=[("Used class time well", 3.87, 3.39, 3.53),
             ("Well prepared for each class", 3.87, 3.51, 3.62),
             ("Graded fairly", 3.82, 3.52, 3.58),
             ("Available for consultation", 3.76, 3.49, 3.59),
             ("Syllabus matched what was taught", 3.74, 3.49, 3.60),
             ("Free to ask questions", 3.71, 3.43, 3.56),
             ("Raised challenging questions", 3.68, 3.32, 3.48),
             ("Exams reflected course material", 3.68, 3.44, 3.54),
             ("Clear, understandable lectures", 3.63, 3.19, 3.48)]),
]

def draw(e, out):
    rows = [e["overall"]] + e["items"]
    n = len(rows)
    top = 1.35
    fig_h = top + 0.75 + 0.40 * n
    fig = plt.figure(figsize=(7.4, fig_h), dpi=240)
    ax = fig.add_axes([0.385, 0.75 / fig_h, 0.545, (0.40 * n) / fig_h])
    ys = list(range(n))[::-1]
    ys = [y - (0.45 if i > 0 else 0) for i, y in enumerate(ys)]  # gap below overall row
    lo, hi = e["xlim"]
    # overall-row band
    ax.axhspan(ys[0] - 0.42, ys[0] + 0.42, color="#F6F3E6", zorder=0, lw=0)
    for x in [t / 10 for t in range(int(lo * 10), int(hi * 10) + 1, 2 if e["scale"] == 5 else 1)]:
        ax.axvline(x, color=RULE, lw=0.6, zorder=1)
    for (label, c, d, col), y in zip(rows, ys):
        ax.plot([min(c, d, col), max(c, d, col)], [y, y], color="#C9CFD8", lw=2.2, solid_capstyle="round", zorder=2)
        ax.scatter(col, y, marker="D", s=46, color=COLL, edgecolor="white", linewidth=1.2, zorder=3)
        ax.scatter(d, y, marker="o", s=62, facecolor="white", edgecolor=DEPT, linewidth=1.8, zorder=4)
        ax.scatter(c, y, marker="o", s=118, color=NAVY, edgecolor="white", linewidth=1.6, zorder=5)
        ax.text(max(c, d, col) + (hi - lo) * 0.032, y, f"{c:.2f}", va="center", ha="left",
                fontsize=10.5, fontfamily=SANS, fontweight="bold", color=INK, zorder=6)
    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontfamily=SANS, fontsize=10.5, color=INK)
    ax.get_yticklabels()[0].set_fontweight("bold")
    ax.set_xlim(lo, hi + (hi - lo) * 0.10)
    ax.set_ylim(min(ys) - 0.55, ys[0] + 0.5)
    ticks = [t / 10 for t in range(int(lo * 10), int(hi * 10) + 1, 2 if e["scale"] == 5 else 1)]
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{t:.1f}" for t in ticks], fontfamily=SANS, fontsize=9.5, color=MUTED)
    ax.set_xlabel(f"Mean rating (scale 1–{e['scale']}; axis starts at {lo:.1f})", fontfamily=SANS,
                  fontsize=9.5, color=MUTED, labelpad=6)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(length=0, pad=8)
    # header
    fig.text(0.03, 1 - 0.38 / fig_h, e["course"], fontfamily=SERIF, fontsize=15, fontweight="bold", color=INK)
    fig.text(0.03, 1 - 0.66 / fig_h, f"{e['term']}  ·  {e['resp']}", fontfamily=SANS, fontsize=10, color=MUTED)
    handles = [Line2D([], [], marker="o", ls="", ms=9.5, color=NAVY, mec="white", label="My course"),
               Line2D([], [], marker="o", ls="", ms=7.5, mfc="white", mec=DEPT, mew=1.8, label="Economics dept. average"),
               Line2D([], [], marker="D", ls="", ms=6.5, color=COLL, mec="white", label="LeBow College average")]
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(0.02, 1 - 0.86 / fig_h), ncol=3,
               frameon=False, prop={"family": SANS, "size": 9.5}, labelcolor=INK, handletextpad=0.3,
               columnspacing=1.4)
    fig.savefig(out, facecolor="white")
    plt.close(fig)

if __name__ == "__main__":
    import sys
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    for e in EVALS:
        draw(e, f"{outdir}/{e['key']}.png")
