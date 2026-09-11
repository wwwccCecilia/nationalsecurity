(function () {
  "use strict";

  const section = document.querySelector("#survey-report-section");
  if (!section) return;

  const cards = Array.from(section.querySelectorAll(".survey-card"));
  const reader = section.querySelector("#survey-reader");
  const readerImage = section.querySelector("#survey-reader-image");
  const readerTitle = section.querySelector("#survey-reader-title");
  const readerDate = section.querySelector("#survey-reader-date");
  const readerScroll = section.querySelector("#survey-reader-scroll");
  const closeButton = section.querySelector("#survey-reader-close");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let selectedCard = null;
  let closeTimer = 0;
  let frame = 0;
  let pointerX = 0;
  let pointerY = 0;

  function openReport(card) {
    const cover = card.querySelector(".survey-cover");
    const title = card.querySelector(".survey-card-meta strong");
    const date = card.querySelector(".survey-card-meta small");
    if (!cover || !reader) return;

    window.clearTimeout(closeTimer);
    selectedCard = card;
    readerImage.src = cover.currentSrc || cover.src;
    readerImage.alt = cover.alt;
    readerTitle.textContent = title ? title.textContent : "";
    readerDate.textContent = date ? date.textContent : "";
    readerScroll.scrollTop = 0;
    section.dataset.mode = "detail";
    cards.forEach((item) => item.classList.toggle("selected", item === card));
    reader.hidden = false;
    reader.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => reader.classList.add("open"));
    window.setTimeout(() => closeButton.focus({ preventScroll: true }), reducedMotion.matches ? 0 : 260);
  }

  function closeReport() {
    if (reader.hidden || section.dataset.mode !== "detail") return;
    reader.classList.remove("open");
    section.dataset.mode = "gallery";
    selectedCard?.classList.remove("selected");
    closeTimer = window.setTimeout(() => {
      reader.hidden = true;
      reader.setAttribute("aria-hidden", "true");
      selectedCard?.focus({ preventScroll: true });
      selectedCard = null;
    }, reducedMotion.matches ? 0 : 300);
  }

  function updateParallax() {
    frame = 0;
    if (reducedMotion.matches || section.dataset.mode !== "gallery") return;
    cards.forEach((card, index) => {
      const depth = index === 1 ? 1 : 0.72;
      card.style.setProperty("--local-x", pointerX * 14 * depth + "px");
      card.style.setProperty("--local-y", pointerY * 8 * depth + "px");
    });
  }

  cards.forEach((card) => {
    card.addEventListener("click", () => openReport(card));
  });

  closeButton.addEventListener("click", closeReport);
  reader.addEventListener("click", (event) => {
    if (event.target.closest("[data-survey-close]")) closeReport();
  });

  section.addEventListener(
    "pointermove",
    (event) => {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
      if (!frame) frame = window.requestAnimationFrame(updateParallax);
    },
    { passive: true }
  );

  section.addEventListener(
    "pointerleave",
    () => {
      pointerX = 0;
      pointerY = 0;
      if (!frame) frame = window.requestAnimationFrame(updateParallax);
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReport();
  });
})();
