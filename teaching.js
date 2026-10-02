// Comment carousels on the teaching page (degrades to a plain list without JS).
document.documentElement.classList.add("js");
document.querySelectorAll("[data-carousel]").forEach(function (box) {
  var quotes = box.querySelectorAll(".quote");
  var count = box.querySelector(".count");
  var i = 0;
  function show(n) {
    i = (n + quotes.length) % quotes.length;
    quotes.forEach(function (q, k) { q.classList.toggle("active", k === i); });
    count.textContent = (i + 1) + " / " + quotes.length;
  }
  box.querySelector(".prev").addEventListener("click", function () { show(i - 1); });
  box.querySelector(".next").addEventListener("click", function () { show(i + 1); });
  box.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") show(i - 1);
    if (e.key === "ArrowRight") show(i + 1);
  });
  show(0);
});
