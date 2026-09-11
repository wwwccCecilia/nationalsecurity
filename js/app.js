/* ============================================================
   app.js —— 交互逻辑
   页面流：main --open(上下分屏)--> interact --zoomin(推近)--> scroll
   scroll 卡片点击 = flip(3D 翻面) --> 居中答题卡（背景虚化）
   答对 -> “回答正确” -> 点亮卡片；答错 -> 解析 -> 返回（卡片未点亮）
   ============================================================ */
(function () {
  "use strict";

  const { SHOWTEXT, QUIZ } = window.NS_DATA;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const DUR_OPEN = 1900;
  const DUR_ZOOM = 1700;
  const DUR_FLIP = 1300;
  const easeZoom = "cubic-bezier(0.16, 1, 0.3, 1)";

  const els = {
    main: $("#page-main"),
    startBtn: $("#btn-start"),
    interact: $("#page-interact"),
    interactScroll: $("#interact-scroll"),
    heroBg: $(".hero-bg"),
    scroll: $("#page-scroll"),
    carWrap: $("#car-wrap"),
    carTrack: $("#car-track"),
    carPrev: $("#car-prev"),
    carNext: $("#car-next"),
    backToInteract: $("#back-to-interact"),
    carSub: $(".car-sub"),
    solvedCount: $("#solved-count"),
    totalCount: $("#total-count"),
    overlay: $("#quiz-overlay"),
    quizCard: $("#quiz-card"),
    quizCat: $("#quiz-cat"),
    quizIdx: $("#quiz-idx"),
    quizQ: $("#quiz-q"),
    quizOpts: $("#quiz-opts"),
    quizExplain: $("#quiz-explain"),
    quizActions: $("#quiz-actions"),
    quizDetail: $("#quiz-detail"),
    quizDetailTitle: $("#quiz-detail-title"),
    quizDetailText: $("#quiz-detail-text"),
    quizClose: $("#quiz-close"),
    toast: $("#correct-toast"),
    finalOverlay: $("#final-overlay"),
    finalRestart: $("#final-restart"),
    finalSub: $("#final-sub"),
    curtain: $("#curtain"),
    showtextRoot: $("#showtext-root"),
    njmapStage: $("#njmap-stage"),
    njCanvas: $("#njmap-canvas"),
    njBubble: $("#njmap-bubble"),
    njBubbleClose: $("#njmap-bubble-close"),
    njBubbleTitle: $("#njmap-bubble-title"),
    njBubbleBody: $("#njmap-bubble-body"),
  };

  let view = "main";
  let busy = false; // 页面切换锁
  let quizLock = false; // 答题弹层操作锁
  let answered = false; // 是否已作答
  let quizId = null;
  let mode = "question"; // question | detail
  let finalShown = false;
  let currentQuestionIndex = -1; // 0 起；记录最近操作的题目
  const solved = new Set();
  const STORAGE_KEY = "national-security-quiz-progress";

  /* ---------- 本地进度：已答列表 + 当前题目 ---------- */
  function persistProgress() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          currentQuestionIndex: currentQuestionIndex,
          answered: Array.from(solved)
        })
      );
    } catch (err) {
      // 浏览器禁用存储时静默降级
    }
  }

  function restoreProgress() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (err) {
      return;
    }
    if (!data || !Array.isArray(data.answered)) return;

    const validIds = new Set(QUIZ.map((q) => q.id));
    data.answered.forEach((id) => {
      const num = Number(id);
      if (validIds.has(num)) solved.add(num);
    });
    const idx = Number(data.currentQuestionIndex);
    if (Number.isInteger(idx) && idx >= 0 && idx < QUIZ.length) {
      currentQuestionIndex = idx;
    }
  }

  function clearProgress() {
    solved.clear();
    currentQuestionIndex = -1;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // 忽略
    }
  }

  // —— 点击灵敏 + 滚动分离 ——
  let downX = 0;
  let downY = 0;
  let dragMoved = false;

  /* ---------- 展示文字 ---------- */
  function renderShowtext() {
    const root = els.showtextRoot;
    root.innerHTML = "";

    SHOWTEXT.forEach((sec) => {
      const el = document.createElement("section");
      el.className = "text-section";
      const h = document.createElement("h3");
      h.textContent = sec.title;
      el.appendChild(h);

      if (sec.paras) {
        sec.paras.forEach((p) => {
          const pe = document.createElement("p");
          pe.textContent = p;
          el.appendChild(pe);
        });
      }
      if (sec.intro) {
        const pe = document.createElement("p");
        pe.textContent = sec.intro;
        el.appendChild(pe);
      }
      if (sec.items) {
        const ul = document.createElement("ul");
        ul.className = "textitem-list";
        sec.items.forEach((it) => {
          const li = document.createElement("li");
          li.textContent = it;
          ul.appendChild(li);
        });
        el.appendChild(ul);
      }
      if (sec.groups) {
        const ul = document.createElement("ul");
        ul.className = "textgroup-list";
        sec.groups.forEach((g) => {
          const li = document.createElement("li");
          const st = document.createElement("strong");
          st.textContent = g.label;
          li.appendChild(st);
          li.appendChild(document.createTextNode(g.body));
          ul.appendChild(li);
        });
        el.appendChild(ul);
      }
      if (sec.closing) {
        const pe = document.createElement("p");
        pe.className = "text-closing";
        pe.textContent = sec.closing;
        el.appendChild(pe);
      }
      root.appendChild(el);
    });

  }

  /* ---------- 横向卡片车：左右滑动 + 点击答题 ---------- */
  function cardHTML(quiz) {
    return (
      '<div class="card-inner">' +
      '<div class="card-face card-front">' +
      '<img src="' + quiz.img + '" alt="' + quiz.category + '" draggable="false" />' +
      '<span class="card-solved-badge">✓</span>' +
      '<span class="card-cat">' + quiz.category + "</span>" +
      '<span class="card-arm-tip">点击答题</span>' +
      "</div>" +
      '<div class="card-face card-back">' +
      '<span class="card-back-q">?</span>' +
      '<span class="card-back-cat">' + quiz.category + "</span>" +
      '<span class="card-back-tip">进入答题</span>' +
      "</div>" +
      "</div>"
    );
  }

  function buildCarousel() {
    const track = els.carTrack;
    track.innerHTML = "";
    QUIZ.forEach((quiz) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "card";
      b.dataset.id = String(quiz.id);
      b.setAttribute("aria-label", quiz.category + " 知识问答");
      b.innerHTML = cardHTML(quiz);
      b.addEventListener("click", () => {
        // 灵敏：点击立即答题；仅触屏拖动滚动时不误触
        if (dragMoved) return;
        openQuiz(quiz.id);
      });
      track.appendChild(b);
    });
    els.totalCount.textContent = String(QUIZ.length);
  }

  function updateSolved() {
    els.solvedCount.textContent = String(solved.size);
    if (solved.size === QUIZ.length) {
      els.carSub.textContent = "🎉 全部点亮 · 你我同筑国家安全 🎉";
    }
  }

  function markSolvedCards() {
    QUIZ.forEach((quiz) => {
      const c = card(quiz.id);
      if (!c || !solved.has(quiz.id)) return;
      c.classList.add("solved");
      const tip = c.querySelector(".card-arm-tip");
      if (tip) tip.textContent = "查看解读";
    });
  }

  function card(id) {
    return els.carTrack.querySelector('[data-id="' + id + '"]');
  }

  /* ---------- 南京行政区划：点击高亮（严格贴合地图黑线） ---------- */
  function initNanjingMap() {
    const canvas = els.njCanvas;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      canvas.width = W;
      canvas.height = H;
      ctx.drawImage(img, 0, 0);
      const base = ctx.getImageData(0, 0, W, H);
      const src = base.data;
      const total = W * H;
      let active = null; // Uint8Array：当前点亮区域像素掩码
      const districtList = window.NS_NJ || [];
      const districtLabels = new Uint8Array(total); // 0=未归属，1-11=区
      const COLOR_TOLERANCE = 48;
      const MIN_COMPONENT_PIXELS = 80;

      function render() {
        if (!active) {
          ctx.putImageData(base, 0, 0);
          return;
        }
        const out = ctx.createImageData(W, H);
        const od = out.data;
        for (let p = 0; p < total; p++) {
          const i = p * 4;
          if (active[p]) {
            od[i] = src[i] * 1.1 + 26 > 255 ? 255 : src[i] * 1.1 + 26;
            od[i + 1] = src[i + 1] * 1.06 + 20 > 255 ? 255 : src[i + 1] * 1.06 + 20;
            od[i + 2] = src[i + 2] * 1.02 + 14 > 255 ? 255 : src[i + 2] * 1.02 + 14;
          } else {
            od[i] = src[i] * 0.45;
            od[i + 1] = src[i + 1] * 0.45;
            od[i + 2] = src[i + 2] * 0.45;
          }
          od[i + 3] = src[i + 3];
        }
        ctx.putImageData(out, 0, 0);
      }

      // 按相邻同色色块聚类，再用“同色种子 + 最近行政区质心”做归属
      function districtSeedColors() {
        return districtList.map((dist) => {
          const counts = new Map();
          const cx = Math.round(dist.cx);
          const cy = Math.round(dist.cy);
          const y0 = Math.max(0, cy - 14);
          const y1 = Math.min(H - 1, cy + 14);
          const x0 = Math.max(0, cx - 14);
          const x1 = Math.min(W - 1, cx + 14);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const i = (y * W + x) * 4;
              const r = src[i], g = src[i + 1], b = src[i + 2];
              const sum = r + g + b;
              if (sum <= 150 || sum >= 742) continue;
              const key = r + "," + g + "," + b;
              counts.set(key, (counts.get(key) || 0) + 1);
            }
          }
          let bestKey = null;
          let bestCount = 0;
          counts.forEach((count, key) => {
            if (count > bestCount) {
              bestCount = count;
              bestKey = key;
            }
          });
          if (!bestKey) {
            const i = (Math.round(dist.cy) * W + Math.round(dist.cx)) * 4;
            return [src[i], src[i + 1], src[i + 2]];
          }
          return bestKey.split(",").map(Number);
        });
      }

      function buildDistrictLabels(seedColors) {
        const seen = new Uint8Array(total);
        const stack = [];
        const comp = [];

        function addNeighbor(ni, sr, sg, sb) {
          if (seen[ni]) return;
          const i = ni * 4;
          const r = src[i], g = src[i + 1], b = src[i + 2];
          const sum = r + g + b;
          if (sum <= 150 || sum >= 742) return;
          if (Math.abs(r - sr) + Math.abs(g - sg) + Math.abs(b - sb) > COLOR_TOLERANCE) return;
          seen[ni] = 1;
          stack.push(ni);
        }

        for (let p = 0; p < total; p++) {
          const i = p * 4;
          const r = src[i], g = src[i + 1], b = src[i + 2];
          const sum = r + g + b;
          if (sum <= 150 || sum >= 742 || seen[p]) continue;

          const seedR = r, seedG = g, seedB = b;
          seen[p] = 1;
          stack.length = 0;
          stack.push(p);
          comp.length = 0;
          while (stack.length) {
            const cur = stack.pop();
            comp.push(cur);
            const cx = cur % W, cy = (cur / W) | 0;
            if (cx > 0) addNeighbor(cur - 1, seedR, seedG, seedB);
            if (cx < W - 1) addNeighbor(cur + 1, seedR, seedG, seedB);
            if (cy > 0) addNeighbor(cur - W, seedR, seedG, seedB);
            if (cy < H - 1) addNeighbor(cur + W, seedR, seedG, seedB);
          }

          const count = comp.length;
          let sumX = 0, sumY = 0, sumR = 0, sumG = 0, sumB = 0;
          for (let j = 0; j < count; j++) {
            const q = comp[j];
            const qi = q * 4;
            sumX += q % W;
            sumY += (q / W) | 0;
            sumR += src[qi];
            sumG += src[qi + 1];
            sumB += src[qi + 2];
          }
          const avgR = sumR / count;
          const avgG = sumG / count;
          const avgB = sumB / count;
          const ccx = sumX / count;
          const ccy = sumY / count;

          let bestIndex = -1;
          let bestScore = Infinity;
          for (let di = 0; di < districtList.length; di++) {
            const dc = seedColors[di];
            const cd = Math.abs(dc[0] - avgR) + Math.abs(dc[1] - avgG) + Math.abs(dc[2] - avgB);
            if (cd > 80) continue;
            const dx = districtList[di].cx - ccx;
            const dy = districtList[di].cy - ccy;
            const score = Math.sqrt(dx * dx + dy * dy) + cd * 0.5;
            if (score < bestScore) {
              bestScore = score;
              bestIndex = di;
            }
          }
          if (bestIndex >= 0 && count >= MIN_COMPONENT_PIXELS) {
            const label = bestIndex + 1;
            for (let j = 0; j < count; j++) districtLabels[comp[j]] = label;
          }
        }
      }

      function districtLabelAt(px, py) {
        let bestLabel = 0;
        let bestD = Infinity;
        for (let r = 0; r <= 18; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = px + dx, ny = py + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const label = districtLabels[ny * W + nx];
              if (!label) continue;
              const d = dx * dx + dy * dy;
              if (d < bestD) {
                bestD = d;
                bestLabel = label;
              }
            }
          }
        }
        return bestLabel;
      }

      function fillInteriorHoles(mask) {
        const reach = new Uint8Array(total);
        const st2 = [];
        function pushR(ni) {
          if (reach[ni]) return;
          reach[ni] = 1;
          st2.push(ni);
        }
        function tryR(ni) {
          if (reach[ni] || mask[ni]) return;
          reach[ni] = 1;
          st2.push(ni);
        }
        for (let x = 0; x < W; x++) { pushR(x); pushR((H - 1) * W + x); }
        for (let y = 0; y < H; y++) { pushR(y * W); pushR(y * W + W - 1); }
        while (st2.length) {
          const cur = st2.pop();
          const cx = cur % W, cy = (cur / W) | 0;
          if (cx > 0) tryR(cur - 1);
          if (cx < W - 1) tryR(cur + 1);
          if (cy > 0) tryR(cur - W);
          if (cy < H - 1) tryR(cur + W);
        }
        for (let p = 0; p < total; p++) if (!reach[p]) mask[p] = 1;
      }

      function dilateMaskOnce(mask) {
        const grown = new Uint8Array(total);
        for (let p = 0; p < total; p++) {
          if (!mask[p]) continue;
          const x = p % W, y = (p / W) | 0;
          grown[p] = 1;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= W) continue;
              grown[ny * W + nx] = 1;
            }
          }
        }
        return grown;
      }

      function districtMaskAt(px, py) {
        const label = districtLabelAt(px, py);
        if (!label) return null;
        const gulouLabel = districtList.findIndex((d) => d.name === "鼓楼区") + 1;
        let mask = new Uint8Array(total);
        for (let p = 0; p < total; p++) {
          if (districtLabels[p] === label) mask[p] = 1;
        }
        fillInteriorHoles(mask);
        if (label === gulouLabel) mask = dilateMaskOnce(mask);
        return { mask: mask, label: label };
      }

      buildDistrictLabels(districtSeedColors());

      canvas.addEventListener(
        "click",
        (e) => {
          const rect = canvas.getBoundingClientRect();
          const px = Math.round((e.clientX - rect.left) * (W / rect.width));
          const py = Math.round((e.clientY - rect.top) * (H / rect.height));
          if (px < 0 || py < 0 || px >= W || py >= H) return;
          const found = districtMaskAt(px, py);
          if (!found) {
            resetNanjingMap();
            return;
          }
          const mask = found.mask;
          active = mask;
          render();
          const c = maskCentroid(mask);
          const dist = districtList[found.label - 1];
          if (dist) showNjBubble(dist, c.cx, c.cy);
        },
        { passive: true }
      );
      // 识别点击区 + 气泡
      function maskCentroid(mask) {
        let sx = 0, sy = 0, n = 0;
        for (let p = 0; p < total; p++) {
          if (mask[p]) {
            sx += p % W;
            sy += (p / W) | 0;
            n++;
          }
        }
        return n ? { cx: sx / n, cy: sy / n } : { cx: 0, cy: 0 };
      }
      function showNjBubble(dist, ccx, ccy) {
        // 画布坐标 -> stage 坐标
        const stageRect = els.njmapStage.getBoundingClientRect();
        const cRect = canvas.getBoundingClientRect();
        const dX = cRect.left + (ccx / W) * cRect.width - stageRect.left;
        const dY = cRect.top + (ccy / H) * cRect.height - stageRect.top;
        let html = "";
        dist.resources.forEach((r) => {
          html += '<div class="njmap-res"><b>' + r.place + "</b><span>" + r.desc + "</span></div>";
        });
        els.njBubbleTitle.textContent = dist.name;
        els.njBubbleBody.innerHTML = html;
        const bub = els.njBubble;
        bub.hidden = false;
        const bw = bub.offsetWidth || 330;
        const bh = bub.offsetHeight || 220;
        const toRight = dX < stageRect.width * 0.5;
        let left = toRight ? dX + 34 : dX - bw - 34;
        let top = dY - bh / 2;
        left = Math.max(6, Math.min(left, stageRect.width - bw - 6));
        top = Math.max(6, Math.min(top, stageRect.height - bh - 6));
        bub.style.left = left + "px";
        bub.style.top = top + "px";
        bub.style.setProperty("--beak-y", Math.max(14, Math.min(dY - top, bh - 14)) + "px");
        bub.dataset.side = toRight ? "right" : "left";
        requestAnimationFrame(() => requestAnimationFrame(() => bub.classList.add("open")));
      }
      function resetNanjingMap() {
        active = null;
        render();
        if (els.njBubble) hideNjBubble();
      }
      function hideNjBubble() {
        els.njBubble.classList.remove("open");
        setTimeout(() => {
          els.njBubble.hidden = true;
        }, 360);
      }
      if (els.njBubbleClose) {
        els.njBubbleClose.addEventListener("click", (ev) => {
          ev.stopPropagation();
          resetNanjingMap();
        });
      }
      render();
    };
    img.src = window.NS_MAP_SRC || "assets/nanjing-map.jpg";
  }

  /* ---------- 视图切换 ---------- */
  function setView(v) {
    view = v;
    document.body.dataset.view = v;
  }

  function currentHashView() {
    const h = (location.hash || "").replace("#", "");
    if (h === "scroll") return "scroll";
    if (h === "interact" || h.indexOf("njbubble") === 0) return "interact";
    return "main";
  }

  function pushScrollRoute() {
    const target = "#scroll";
    if ((location.hash || "").replace("#", "") === "scroll") return;
    try {
      history.pushState({ view: "scroll" }, "", target);
    } catch (err) {
      try { location.hash = target; } catch (ignored) { /* 忽略 */ }
    }
  }

  function replaceCurrentRoute(name) {
    const target = "#" + name;
    try {
      history.replaceState({ view: name }, "", target);
    } catch (err) {
      try { location.hash = target; } catch (ignored) { /* 忽略 */ }
    }
  }

  function centerCurrentCard() {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= QUIZ.length) return;
    const target = card(QUIZ[currentQuestionIndex].id);
    const wrap = els.carWrap;
    if (!target || !wrap) return;
    const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    const x = target.offsetLeft - (wrap.clientWidth - target.offsetWidth) / 2;
    wrap.scrollLeft = Math.max(0, Math.min(max, x));
    updateCarNav();
  }

  function returnToInteract() {
    if (busy) return;
    persistProgress();
    els.overlay.hidden = true;
    els.overlay.classList.remove("open");
    els.scroll.classList.remove("active");
    els.scroll.style.visibility = "hidden";
    els.interact.classList.add("active");
    els.interact.style.visibility = "visible";
    els.interact.style.opacity = "";
    els.interactScroll.scrollTop = 0;
    setView("interact");
    replaceCurrentRoute("interact");
  }

  function returnToMain() {
    if (busy) return;
    els.scroll.classList.remove("active");
    els.interact.classList.remove("active");
    els.interact.style.visibility = "hidden";
    els.main.classList.remove("hidden");
    setView("main");
  }

  // open：上下分屏拉开（main -> interact）
  function startLearning() {
    if (busy) return;
    busy = true;

    els.interact.classList.add("active");

    const makeHalf = (half) => {
      const c = els.main.cloneNode(true);
      c.removeAttribute("id");
      c.classList.remove("hidden");
      c.style.transition = "none";
      c.setAttribute("aria-hidden", "true");
      $$("[id]", c).forEach((n) => n.removeAttribute("id"));
      c.classList.add("clone-half", half);
      return c;
    };

    const top = makeHalf("top");
    const bot = makeHalf("bottom");
    els.curtain.append(top, bot);

    // 克隆体盖住原页后，立刻隐藏原页，避免“露底”
    els.main.classList.add("hidden");

    // 撕开瞬间的柔光扫过
    const flash = document.createElement("div");
    flash.className = "curtain-flash";
    flash.style.transition = "opacity 1s ease";
    els.curtain.appendChild(flash);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flash.style.opacity = "0.9";
    }));
    setTimeout(() => {
      flash.style.opacity = "0";
    }, 700);

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        top.classList.add("open-top");
        bot.classList.add("open-bottom");
      })
    );

    setTimeout(() => {
      top.remove();
      bot.remove();
      flash.remove();
      els.interactScroll.scrollTop = 0;
      setView("interact");
      busy = false;
    }, DUR_OPEN + 60);
  }

  // zoomin：镜头推近 + 淡出（interact -> scroll）
  function enterScroll() {
    if (busy || view !== "interact") return;
    persistProgress();
    pushScrollRoute();
    busy = true;
    const scr = els.scroll;
    const inter = els.interact;

    // 下一页（scroll）先待命：小、透明、位于底层
    scr.style.visibility = "visible";
    scr.style.opacity = "0";
    scr.style.transform = "scale(0.86)";
    scr.style.transition =
      "opacity " + DUR_ZOOM + "ms " + easeZoom + ", transform " + DUR_ZOOM + "ms " + easeZoom;

    // 当前页（interact）推近 + 淡出
    inter.style.transformOrigin = "50% 50%";
    inter.style.transition =
      "transform " + DUR_ZOOM + "ms " + easeZoom + ", opacity " + DUR_ZOOM + "ms " + easeZoom;
    inter.style.pointerEvents = "none";

    void scr.offsetWidth;

    requestAnimationFrame(() => {
      inter.style.transform = "scale(1.5)";
      inter.style.opacity = "0";
      scr.style.opacity = "1";
      scr.style.transform = "scale(1)";
    });

    setTimeout(() => {
      inter.style.transition = "";
      inter.style.transform = "";
      inter.style.opacity = "";
      inter.style.visibility = "hidden";
      inter.style.pointerEvents = "";
      inter.classList.remove("active");

      scr.style.transition = "";
      scr.style.opacity = "";
      scr.style.transform = "";
      scr.style.visibility = "";
      scr.classList.add("active");
      scr.scrollTop = 0;

      setView("scroll");
      requestAnimationFrame(centerCurrentCard);
      busy = false;
    }, DUR_ZOOM + 60);
  }

  /* ---------- 答题弹层 ---------- */
  /* ---------- 答题弹层 ---------- */
  function openQuiz(id) {
    if (quizLock || busy || finalShown) return;
    quizLock = true;
    quizId = id;
    answered = false;
    const quiz = QUIZ.find((q) => q.id === id);
    const quizIndex = QUIZ.indexOf(quiz);
    if (quizIndex >= 0) {
      currentQuestionIndex = quizIndex;
      persistProgress();
    }

    // 已点亮：直接进入详细解读
    if (solved.has(id)) {
      showDetailMode(quiz);
      return;
    }

    const idx = QUIZ.indexOf(quiz) + 1;
    els.quizCat.textContent = quiz.category;
    els.quizIdx.textContent = "第 " + idx + " / " + QUIZ.length + " 题";
    els.quizQ.textContent = quiz.q;
    buildOptions(quiz);
    els.quizExplain.hidden = true;
    els.quizActions.hidden = true;
    els.quizDetail.hidden = true;
    els.quizQ.hidden = false;
    els.quizOpts.hidden = false;

    // 卡片翻面作过渡
    const c = card(id);
    if (c) c.classList.add("flipping");
    openOverlay();
  }

  function showDetailMode(quiz) {
    mode = "detail";
    els.quizCat.textContent = quiz.category;
    els.quizIdx.textContent = "";
    els.quizQ.hidden = true;
    els.quizOpts.hidden = true;
    els.quizExplain.hidden = true;
    els.quizActions.hidden = true;
    els.quizDetail.hidden = false;
    els.quizDetailTitle.textContent = quiz.category + " · 深度解读";
    els.quizDetailText.textContent =
      (window.NS_DATA.DETAIL && window.NS_DATA.DETAIL[quiz.category]) || quiz.explain;
    openOverlay();
  }

  function openOverlay() {
    els.overlay.hidden = false;
    els.overlay.setAttribute("aria-hidden", "false");
    void els.overlay.offsetWidth;
    els.overlay.classList.add("open");
    setTimeout(() => {
      quizLock = false;
    }, 460);
  }

  function buildOptions(quiz) {
    const letters = ["A", "B", "C", "D"];
    els.quizOpts.innerHTML = "";
    quiz.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.dataset.letter = letters[i];
      btn.innerHTML =
        '<span class="letter">' + letters[i] + ".</span><span>" + opt + "</span>";
      btn.addEventListener("click", () => selectOption(letters[i]));
      els.quizOpts.appendChild(btn);
    });
  }

  function lockOptions() {
    $$(".quiz-opt", els.quizOpts).forEach((btn) => {
      btn.style.pointerEvents = "none";
      btn.disabled = true;
    });
  }

  function selectOption(letter) {
    if (answered) return;
    answered = true;
    const quiz = QUIZ.find((q) => q.id === quizId);
    const correct = quiz.answer;
    const clicked = els.quizOpts.querySelector('[data-letter="' + letter + '"]');
    const right = els.quizOpts.querySelector('[data-letter="' + correct + '"]');
    lockOptions();

    if (letter === correct) {
      if (right) right.classList.add("selected-correct");
      showCorrect(quiz);
    } else {
      if (clicked) clicked.classList.add("selected-wrong");
      if (right) right.classList.add("selected-correct");
      showExplain(quiz);
    }
  }

  function showCorrect(quiz) {
    quizLock = true;
    answered = true;
    els.toast.hidden = false;
    void els.toast.offsetWidth;
    els.toast.classList.add("show");
    setTimeout(() => {
      els.toast.classList.remove("show");
      els.toast.hidden = true;

      if (quizId == null) return;
      solved.add(quizId);
      const c = card(quizId);
      if (c) {
        c.classList.add("solved");
        c.classList.remove("flipping");
        const tip = c.querySelector(".card-arm-tip");
        if (tip) tip.textContent = "查看解读";
      }
      updateSolved();
      persistProgress();
      showDetailMode(quiz);
    }, 1150);
  }

  function showExplain(quiz) {
    els.quizExplain.innerHTML =
      "<strong>解析 · " + quiz.category + "</strong><br>" + quiz.explain;
    els.quizExplain.hidden = false;
    els.quizActions.innerHTML =
      '<button type="button" class="quiz-back-btn">返回卡片墙</button>';
    els.quizActions.hidden = false;
    $(".quiz-back-btn", els.quizActions).addEventListener("click", closeQuiz);
  }

  function closeQuiz() {
    const wasLast = solved.size === QUIZ.length;
    els.overlay.classList.remove("open");
    setTimeout(() => {
      els.overlay.hidden = true;
      els.overlay.setAttribute("aria-hidden", "true");
      const c = card(quizId);
      if (c) c.classList.remove("flipping");
      resetQuizUI();
      quizId = null;
      quizLock = false;
      mode = "question";
      if (wasLast && !finalShown) setTimeout(showFinal, 600);
    }, 380);
  }

  function resetQuizUI() {
    els.quizOpts.innerHTML = "";
    els.quizExplain.hidden = true;
    els.quizActions.hidden = true;
    els.quizDetail.hidden = true;
    els.quizQ.hidden = false;
    els.quizOpts.hidden = false;
    answered = false;
    mode = "question";
  }

  /* ---------- 结算界面 ---------- */
  function showFinal() {
    if (finalShown) return;
    finalShown = true;
    els.finalSub.textContent = QUIZ.length + " 个领域守护之卡已全部点亮 · 山河无恙";
    els.finalOverlay.hidden = false;
    els.finalOverlay.setAttribute("aria-hidden", "false");
    void els.finalOverlay.offsetWidth;
    els.finalOverlay.classList.add("open");
  }

  /* ---------- 事件绑定 ---------- */
  els.startBtn.addEventListener("click", startLearning);
  els.backToInteract.addEventListener("click", returnToInteract);
  window.addEventListener("popstate", () => {
    if (busy) return;
    const hv = currentHashView();
    if (view === "scroll" && hv !== "scroll") returnToInteract();
    else if (view === "interact" && hv === "main") returnToMain();
  });
  els.interactScroll.addEventListener("click", (e) => {
    if (view !== "interact" || busy) return;
    if (els.interactScroll.scrollTop < 8) enterScroll();
  });
  els.quizClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeQuiz();
  });
  els.finalRestart.addEventListener("click", () => {
    clearProgress();
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (err) {
      // 忽略
    }
    location.reload();
  });

  // 触屏：记录按下位置，一旦拖动滚动即标记，避免“点卡答题”把滚动误判为点击
  els.carWrap.addEventListener(
    "pointerdown",
    (e) => {
      downX = e.clientX;
      downY = e.clientY;
      dragMoved = false;
    },
    { passive: true }
  );
  els.carWrap.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch" && (downX || downY)) {
        const d = Math.hypot(e.clientX - downX, e.clientY - downY);
        if (d > 12) dragMoved = true;
      }
    },
    { passive: true }
  );
  els.carWrap.addEventListener(
    "pointercancel",
    () => {
      dragMoved = true;
    },
    { passive: true }
  );

  // 鼠标滚轮/触控板 → 横向滑动；保证滑动后仍可点卡
  els.carWrap.addEventListener(
    "wheel",
    (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      e.preventDefault();
      els.carWrap.scrollLeft += d;
    },
    { passive: false }
  );

  // 左右箭头：翻一张
  function stepCar(dir) {
    const cardW = els.carTrack.querySelector(".card");
    const step = cardW ? (cardW.getBoundingClientRect().width + 24) * dir : dir * 300;
    els.carWrap.scrollBy({ left: step, behavior: "smooth" });
  }
  els.carPrev.addEventListener("click", () => stepCar(-1));
  els.carNext.addEventListener("click", () => stepCar(1));
  function updateCarNav() {
    const max = els.carWrap.scrollWidth - els.carWrap.clientWidth;
    const x = els.carWrap.scrollLeft;
    els.carPrev.classList.toggle("is-hidden", x <= 4);
    els.carNext.classList.toggle("is-hidden", x >= max - 4);
  }
  els.carWrap.addEventListener("scroll", updateCarNav, { passive: true });
  window.addEventListener("resize", updateCarNav);
  updateCarNav();

  // 详细解读模式下：点击任意处收起（弹层内任意位置）
  els.overlay.addEventListener("click", () => {
    if (mode === "detail" && !busy) closeQuiz();
  });

  // 键盘：首页回车/空格进入，interact 顶部回车进入
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && view === "main") startLearning();
  });

  /* ---------- 初始化 ---------- */
  restoreProgress();
  renderShowtext();
  buildCarousel();
  markSolvedCards();
  initNanjingMap();
  updateSolved();
  applyHashNav();

  // 支持 #interact / #scroll 直达某一页面（便于分享与预览）
  function applyHashNav() {
    const h = (location.hash || "").replace("#", "");
    if (h.indexOf("njbubble") === 0) {
      els.main.classList.add("hidden");
      els.interact.classList.add("active");
      setView("interact");
      const st = document.createElement("style");
      st.textContent = ".interact-hero,.textinfo{display:none!important} #page-interact{background:#120c08}";
      document.head.appendChild(st);
      const fx = parseFloat((h.split("=")[1] || "0.45"));
      const fy = parseFloat((h.split("=")[2] || "0.17"));
      const once = () => {
        const c = els.njCanvas;
        if (!c || !c.width) { setTimeout(once, 100); return; }
        setTimeout(() => {
          const r = c.getBoundingClientRect();
          c.dispatchEvent(new MouseEvent("click", {
            clientX: r.left + fx * r.width,
            clientY: r.top + fy * r.height,
            bubbles: false,
          }));
        }, 500);
      };
      once();
      return;
    }
    if (h === "interact") {
      els.main.classList.add("hidden");
      els.interact.classList.add("active");
      els.interactScroll.scrollTop = 0;
      setView("interact");
    } else if (h === "scroll") {
      els.main.classList.add("hidden");
      els.scroll.classList.add("active");
      setView("scroll");
      requestAnimationFrame(centerCurrentCard);
    }
  }
})();
