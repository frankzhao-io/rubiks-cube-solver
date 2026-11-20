// Main UI Controller for 3D Rubik's Cube Step-by-Step Solver
(function () {
  const { Cube, FACES, FACE_COLORS, FACE_NORMALS, MOVE_SPEC } = window.CubeModel;
  const { solveCubeLBL, invertMove } = window.CubeSolver;
  const { solveCubeCFOP } = window.CubeCFOPSolver;
  const { solveCubeOptimal } = window.CubeOptimalSolver;

  const cube = new Cube();
  let solutionSteps = [];
  let currentStepIdx = 0; // how many steps of solutionSteps have been applied
  let isPlaying = false;
  let isAnimating = false;
  let paintMode = false;
  let selectedPaintColor = "U";
  let solveMode = "lbl"; // "lbl" | "optimal"
  let manualHistory = [];
  let lastScrambleStr = "";
  let expandAllPhases = false;
  let timelineGroups = [];

  const historyCountEl = document.getElementById("history-count");
  const historyListEl = document.getElementById("manual-history-list");
  const btnUndoManual = document.getElementById("btn-undo-manual");
  const btnClearHistory = document.getElementById("btn-clear-history");

  function renderManualHistory() {
    historyCountEl.textContent = String(manualHistory.length);
    btnUndoManual.disabled = manualHistory.length === 0;
    btnClearHistory.disabled = manualHistory.length === 0;
    if (manualHistory.length === 0) {
      historyListEl.innerHTML = `<span class="muted">尚未手動轉動</span>`;
      return;
    }
    historyListEl.innerHTML = manualHistory
      .map((m, i) => `<span class="history-chip" title="第 ${i + 1} 步">${m}</span>`)
      .join("");
    historyListEl.scrollTop = historyListEl.scrollHeight;
  }

  const canvas = document.getElementById("cube-canvas");
  const statusEl = document.getElementById("status-banner");
  const activeStepBox = document.getElementById("active-step-box");
  const timelineEl = document.getElementById("timeline");
  const speedSlider = document.getElementById("speed-slider");
  const speedLabel = document.getElementById("speed-label");
  const btnPlay = document.getElementById("btn-play");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnToggleAllPhases = document.getElementById("btn-toggle-all-phases");
  const formulaInput = document.getElementById("formula-input");
  const btnApplyFormula = document.getElementById("btn-apply-formula");
  const btnCopyScramble = document.getElementById("btn-copy-scramble");
  const swatchRowEl = document.getElementById("swatch-row");
  const colorCountsEl = document.getElementById("color-counts");
  const net2dEl = document.getElementById("net-2d");
  const tabBtns = document.querySelectorAll(".mode-tab");
  const tabPanes = document.querySelectorAll(".tab-pane");

  function getAnimDuration() {
    const speed = parseFloat(speedSlider.value || "1");
    return Math.round(280 / speed);
  }

  function normalToFace(n) {
    for (const [f, fn] of Object.entries(FACE_NORMALS)) {
      if (fn[0] === n[0] && fn[1] === n[1] && fn[2] === n[2]) return f;
    }
    return null;
  }

  function applyPaintAt(x, y, z, face) {
    // Lock 6 center cubies so face anchors stay valid
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) === 1) {
      setStatus("🔒 中心塊固定作為基準面，請填色邊塊與角塊。", "warn");
      return;
    }
    cube.setStickerColor(x, y, z, face, selectedPaintColor);
    clearSolution();
    manualHistory = [];
    renderManualHistory();
    renderPaintNetAndCounts();
    const check = cube.validateSolvability();
    setStatus(check.ok ? "✅ 狀態合法，可以點擊「開始求解」" : `⚠️ ${check.reason}`, check.ok ? "ok" : "warn");
  }

  const renderer = new window.CubeRenderer3D(
    canvas,
    () => cube,
    (pos, normal) => {
      if (!paintMode || isAnimating || isPlaying) return;
      const face = normalToFace(normal);
      if (!face) return;
      applyPaintAt(pos[0], pos[1], pos[2], face);
    },
    (moveStr) => {
      if (paintMode || isAnimating || isPlaying) return;
      executeManualMove(moveStr, true);
    }
  );

  const btnDragMode = document.getElementById("btn-drag-mode");
  const dragMoveBadge = document.getElementById("drag-move-badge");
  renderer.onDragPreview = (moveStr, ready) => {
    if (!moveStr) {
      dragMoveBadge.classList.add("hidden");
      dragMoveBadge.classList.remove("ready");
      return;
    }
    dragMoveBadge.textContent = moveStr;
    dragMoveBadge.classList.remove("hidden");
    dragMoveBadge.classList.toggle("ready", Boolean(ready));
  };

  function setDragMode(mode) {
    renderer.dragMode = mode;
    const isSmart = mode === "smart";
    btnDragMode.classList.toggle("mode-turn", isSmart);
    btnDragMode.textContent = isSmart ? "✨ 智慧拖曳" : "🔒 僅轉視角";
  }
  btnDragMode.addEventListener("click", () => {
    setDragMode(renderer.dragMode === "smart" ? "orbit" : "smart");
  });

  function switchTab(tabName) {
    tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    tabPanes.forEach((pane) => {
      pane.classList.toggle("active", pane.id === `tab-${tabName}`);
    });
    paintMode = tabName === "paint";
    renderer.swipeEnabled = !paintMode;
    if (paintMode) {
      renderPaintNetAndCounts();
      setStatus("🎨 手動填色模式：可點 3D 貼紙或 2D 展開圖（中心塊已鎖定）。", "info");
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isAnimating || isPlaying) return;
      switchTab(btn.dataset.tab);
    });
  });

  function setStatus(msg, type = "info") {
    statusEl.textContent = msg;
    statusEl.className = `status-banner status-${type}`;
  }

  function clearSolution() {
    isPlaying = false;
    solutionSteps = [];
    currentStepIdx = 0;
    btnPlay.textContent = "▶️ 自動播放";
    renderTimeline();
    updateActiveStepUI();
  }

  function animateAndApply(moveStr, onDone) {
    if (isAnimating) return;
    isAnimating = true;
    renderer.animateMove(moveStr, getAnimDuration(), () => {
      cube.applyMove(moveStr);
      isAnimating = false;
      if (onDone) onDone();
    });
  }

  function updateActiveStepUI() {
    if (solutionSteps.length === 0) {
      renderer.highlightLayer = null;
      activeStepBox.innerHTML = `<span class="muted">點擊「🧠 開始求解」產生分層步驟（或用下方按鈕／鍵盤手動轉動）</span>`;
      btnPrev.disabled = true;
      btnNext.disabled = true;
      btnPlay.disabled = true;
      return;
    }

    btnPrev.disabled = currentStepIdx <= 0;
    btnNext.disabled = currentStepIdx >= solutionSteps.length;
    btnPlay.disabled = currentStepIdx >= solutionSteps.length;

    if (currentStepIdx >= solutionSteps.length) {
      renderer.highlightLayer = null;
      activeStepBox.innerHTML = `<strong>🎉 已完成還原！</strong>（共 ${solutionSteps.length} 步）`;
    } else {
      const nextStep = solutionSteps[currentStepIdx];
      const spec = MOVE_SPEC[nextStep.move[0]];
      renderer.highlightLayer = spec ? { axis: spec.axis, layer: spec.layer } : null;
      activeStepBox.innerHTML = `
        <span class="step-badge">下一步 ${currentStepIdx + 1}/${solutionSteps.length}</span>
        <strong class="move-highlight">${nextStep.move}</strong>
        <span>【${nextStep.phase}】${nextStep.desc}</span>
      `;
    }

    document.querySelectorAll(".move-chip").forEach((chip) => {
      const idx = parseInt(chip.dataset.idx, 10);
      chip.classList.toggle("done", idx < currentStepIdx);
      const isCur = idx === currentStepIdx;
      chip.classList.toggle("current", isCur);
      if (isCur) chip.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    syncTimelineAccordion();
  }

  function syncTimelineAccordion() {
    const groupEls = timelineEl.querySelectorAll(".phase-group");
    groupEls.forEach((el, gIdx) => {
      const g = timelineGroups[gIdx];
      if (!g) return;
      const startIdx = g.items[0].idx;
      const endIdx = g.items[g.items.length - 1].idx;
      const doneCount = Math.max(0, Math.min(g.items.length, currentStepIdx - startIdx));
      const isDone = currentStepIdx > endIdx;
      const isActive = currentStepIdx >= startIdx && currentStepIdx <= endIdx;

      el.classList.toggle("phase-done", isDone);
      el.classList.toggle("phase-active", isActive);
      const shouldCollapse = !expandAllPhases && !isActive && !(isDone && currentStepIdx >= solutionSteps.length && gIdx === timelineGroups.length - 1);
      el.classList.toggle("collapsed", shouldCollapse);

      const icon = isDone ? "✓" : isActive ? "▶" : "○";
      const arrow = shouldCollapse ? "▸" : "▾";
      const header = el.querySelector(".phase-header");
      if (header) {
        header.innerHTML = `<span>${icon} ${g.phase}（${doneCount}/${g.items.length} 步）</span><span>${arrow}</span>`;
      }
    });
  }

  function renderTimeline() {
    btnToggleAllPhases.disabled = solutionSteps.length === 0;
    if (solutionSteps.length === 0) {
      timelineGroups = [];
      timelineEl.innerHTML = `<div class="empty-timeline">尚無求解步驟。</div>`;
      return;
    }

    const groups = [];
    for (let i = 0; i < solutionSteps.length; i++) {
      const st = solutionSteps[i];
      if (groups.length === 0 || groups[groups.length - 1].phase !== st.phase) {
        groups.push({ phase: st.phase, items: [] });
      }
      groups[groups.length - 1].items.push({ idx: i, move: st.move, desc: st.desc });
    }
    timelineGroups = groups;

    timelineEl.innerHTML = groups
      .map((g, gIdx) => `
        <div class="phase-group" data-gidx="${gIdx}">
          <button class="phase-header" type="button"></button>
          <div class="chip-row">
            ${g.items.map((it) => `<button class="move-chip" type="button" data-idx="${it.idx}" title="${it.desc}">${it.move}</button>`).join("")}
          </div>
        </div>
      `)
      .join("");

    timelineEl.querySelectorAll(".phase-header").forEach((hdr) => {
      hdr.addEventListener("click", () => {
        const grp = hdr.closest(".phase-group");
        const nowCollapsed = grp.classList.toggle("collapsed");
        const spans = hdr.querySelectorAll("span");
        if (spans[1]) spans[1].textContent = nowCollapsed ? "▸" : "▾";
      });
    });

    timelineEl.querySelectorAll(".move-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (isAnimating || isPlaying) return;
        const targetIdx = parseInt(chip.dataset.idx, 10) + 1;
        while (currentStepIdx < targetIdx) {
          cube.applyMove(solutionSteps[currentStepIdx].move);
          currentStepIdx++;
        }
        while (currentStepIdx > targetIdx) {
          currentStepIdx--;
          cube.applyMove(invertMove(solutionSteps[currentStepIdx].move));
        }
        updateActiveStepUI();
      });
    });
  }

  btnToggleAllPhases.addEventListener("click", () => {
    expandAllPhases = !expandAllPhases;
    btnToggleAllPhases.textContent = expandAllPhases ? "僅看目前階段" : "展開全部";
    syncTimelineAccordion();
  });

  function stepForward(autoLoop = false) {
    if (isAnimating || currentStepIdx >= solutionSteps.length) {
      if (currentStepIdx >= solutionSteps.length) {
        isPlaying = false;
        btnPlay.textContent = "▶️ 自動播放";
      }
      return;
    }
    const move = solutionSteps[currentStepIdx].move;
    animateAndApply(move, () => {
      currentStepIdx++;
      updateActiveStepUI();
      if (autoLoop && isPlaying) {
        setTimeout(() => stepForward(true), 60);
      }
    });
  }

  function stepBackward() {
    if (isAnimating || isPlaying || currentStepIdx <= 0) return;
    const inv = invertMove(solutionSteps[currentStepIdx - 1].move);
    animateAndApply(inv, () => {
      currentStepIdx--;
      updateActiveStepUI();
    });
  }

  function parseMoveSequence(raw) {
    const cleaned = raw.trim().replace(/[’＇]/g, "'").replace(/,/g, " ").toUpperCase();
    if (!cleaned) return { ok: false, reason: "請先輸入打亂或公式（例如：R U R' U'）。" };
    const tokens = cleaned.split(/\s+/);
    const moves = [];
    for (const tok of tokens) {
      const matched = tok.match(/([UDLRFBMES])(['2]?)/g);
      if (!matched || matched.join("") !== tok) {
        return { ok: false, reason: `無法辨識的轉動代號：「${tok}」，僅支援 U D R L F B M E S 搭配 ' 或 2。` };
      }
      moves.push(...matched);
    }
    return { ok: true, moves };
  }

  // Controls
  document.getElementById("btn-scramble").addEventListener("click", () => {
    if (isAnimating || isPlaying) return;
    clearSolution();
    manualHistory = [];
    renderManualHistory();
    const seq = Cube.randomScramble(20);
    cube.applyMoves(seq);
    lastScrambleStr = seq.join(" ");
    formulaInput.value = lastScrambleStr;
    btnCopyScramble.disabled = false;
    if (paintMode) renderPaintNetAndCounts();
    setStatus(`🎲 已隨機打亂（20 步）：${lastScrambleStr}`, "info");
  });

  btnApplyFormula.addEventListener("click", () => {
    if (isAnimating || isPlaying) return;
    const parsed = parseMoveSequence(formulaInput.value);
    if (!parsed.ok) {
      setStatus(`⚠️ ${parsed.reason}`, "warn");
      return;
    }
    clearSolution();
    manualHistory = [];
    renderManualHistory();
    cube.applyMoves(parsed.moves);
    lastScrambleStr = parsed.moves.join(" ");
    btnCopyScramble.disabled = false;
    if (paintMode) renderPaintNetAndCounts();
    setStatus(`📥 已套用 ${parsed.moves.length} 步公式：${lastScrambleStr}`, "ok");
  });

  formulaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnApplyFormula.click();
  });

  btnCopyScramble.addEventListener("click", async () => {
    if (!lastScrambleStr) return;
    try {
      await navigator.clipboard.writeText(lastScrambleStr);
      setStatus(`📋 已複製到剪貼簿：${lastScrambleStr}`, "ok");
    } catch {
      formulaInput.select();
      setStatus("📋 已選取公式文字，請按 Ctrl+C 複製。", "info");
    }
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    if (isAnimating || isPlaying) return;
    clearSolution();
    manualHistory = [];
    renderManualHistory();
    lastScrambleStr = "";
    btnCopyScramble.disabled = true;
    cube.reset();
    if (paintMode) renderPaintNetAndCounts();
    setStatus("🔄 已重設為已還原狀態。", "ok");
  });

  document.querySelectorAll("[data-solve-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isAnimating || isPlaying) return;
      solveMode = btn.dataset.solveMode;
      document.querySelectorAll("[data-solve-mode]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  document.getElementById("btn-solve").addEventListener("click", () => {
    if (isAnimating || isPlaying) return;
    if (paintMode) switchTab("solve");

    const valid = cube.validateSolvability();
    if (!valid.ok) {
      setStatus(`❌ 無法求解：${valid.reason}`, "err");
      return;
    }
    if (cube.isSolved()) {
      setStatus("✅ 方塊已經是還原狀態！", "ok");
      clearSolution();
      return;
    }

    const runSolve = () => {
      const t0 = performance.now();
      const res =
        solveMode === "optimal"
          ? solveCubeOptimal(cube)
          : solveMode === "cfop"
            ? solveCubeCFOP(cube)
            : solveCubeLBL(cube);
      const ms = (performance.now() - t0).toFixed(1);
      if (!res.ok) {
        setStatus("⚠️ 求解未完成，請確認貼紙顏色是否合法。", "err");
        return;
      }
      solutionSteps = res.steps;
      currentStepIdx = 0;
      renderTimeline();
      updateActiveStepUI();
      const label =
        solveMode === "optimal"
          ? "⚡ 最優解（Two-Phase）"
          : solveMode === "cfop"
            ? "🚀 速擰解（CFOP）"
            : "📚 分層解（LBL）";
      setStatus(`${label} 求解成功！共 ${solutionSteps.length} 步（耗時 ${ms} ms），請按「▶️ 自動播放」或「下一步」。`, "ok");
    };

    if (solveMode === "optimal") {
      setStatus("⚡ 正在搜尋最優解（首次需建立搜尋表）...", "info");
      setTimeout(runSolve, 16);
    } else {
      runSolve();
    }
  });

  btnNext.addEventListener("click", () => stepForward(false));
  btnPrev.addEventListener("click", stepBackward);
  btnPlay.addEventListener("click", () => {
    if (solutionSteps.length === 0) return;
    isPlaying = !isPlaying;
    btnPlay.textContent = isPlaying ? "⏸️ 暫停" : "▶️ 自動播放";
    if (isPlaying) stepForward(true);
  });

  speedSlider.addEventListener("input", () => {
    speedLabel.textContent = `${speedSlider.value}x`;
  });

  function renderPaintNetAndCounts() {
    const counts = { U: 0, D: 0, F: 0, B: 0, R: 0, L: 0 };
    for (const cb of cube.cubies) {
      for (const st of cb.stickers) counts[st.c] = (counts[st.c] || 0) + 1;
    }
    colorCountsEl.innerHTML = FACES.map((f) => {
      const ok = counts[f] === 9;
      return `<span class="${ok ? "cnt-ok" : "cnt-bad"}">${FACE_COLORS[f].name} ${counts[f]}/9</span>`;
    }).join("");

    // 2D unfolded net layout: row0=[_,U,_,_], row1=[L,F,R,B], row2=[_,D,_,_]
    const faceGridCoords = {
      U: [-1, 0, 1].flatMap((z) => [-1, 0, 1].map((x) => [x, 1, z])),
      L: [1, 0, -1].flatMap((y) => [-1, 0, 1].map((z) => [-1, y, z])),
      F: [1, 0, -1].flatMap((y) => [-1, 0, 1].map((x) => [x, y, 1])),
      R: [1, 0, -1].flatMap((y) => [1, 0, -1].map((z) => [1, y, z])),
      B: [1, 0, -1].flatMap((y) => [1, 0, -1].map((x) => [x, y, -1])),
      D: [1, 0, -1].flatMap((z) => [-1, 0, 1].map((x) => [x, -1, z])),
    };
    const slots = [null, "U", null, null, "L", "F", "R", "B", null, "D", null, null];
    net2dEl.innerHTML = "";
    for (const face of slots) {
      if (!face) {
        net2dEl.appendChild(document.createElement("div"));
        continue;
      }
      const faceDiv = document.createElement("div");
      faceDiv.className = "net-face";
      faceGridCoords[face].forEach(([x, y, z]) => {
        const isCenter = Math.abs(x) + Math.abs(y) + Math.abs(z) === 1;
        const cCode = cube.getStickerColor(x, y, z, face);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "net-cell" + (isCenter ? " center" : "");
        cell.style.background = FACE_COLORS[cCode].hex;
        cell.title = isCenter ? `${face} 中心塊（鎖定）` : `點擊塗色 (${face})`;
        if (isCenter) cell.textContent = face;
        cell.addEventListener("click", () => applyPaintAt(x, y, z, face));
        faceDiv.appendChild(cell);
      });
      net2dEl.appendChild(faceDiv);
    }
  }

  function selectSwatch(code) {
    selectedPaintColor = code;
    swatchRowEl.querySelectorAll(".swatch").forEach((el) => {
      el.classList.toggle("active", el.dataset.color === code);
    });
  }

  Object.entries(FACE_COLORS).forEach(([code, info], idx) => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.dataset.color = code;
    sw.className = "swatch" + (code === selectedPaintColor ? " active" : "");
    sw.style.background = info.hex;
    sw.title = `${info.name}色（快捷鍵 ${idx + 1}）`;
    sw.textContent = `${idx + 1} ${info.name}`;
    sw.addEventListener("click", () => selectSwatch(code));
    swatchRowEl.appendChild(sw);
  });

  document.querySelectorAll("[data-fill-face]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isAnimating || isPlaying) return;
      const face = btn.dataset.fillFace;
      const n = FACE_NORMALS[face];
      const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
      const layer = n[axis];
      for (const cb of cube.cubies) {
        if (cb.pos[axis] !== layer) continue;
        if (Math.abs(cb.pos[0]) + Math.abs(cb.pos[1]) + Math.abs(cb.pos[2]) === 1) continue;
        cube.setStickerColor(cb.pos[0], cb.pos[1], cb.pos[2], face, selectedPaintColor);
      }
      clearSolution();
      manualHistory = [];
      renderManualHistory();
      renderPaintNetAndCounts();
      const check = cube.validateSolvability();
      setStatus(
        check.ok
          ? `✅ 已將 ${face} 面填滿 ${FACE_COLORS[selectedPaintColor].name}色，狀態合法！`
          : `🎨 已將 ${face} 面填滿 ${FACE_COLORS[selectedPaintColor].name}色（${check.reason}）`,
        check.ok ? "ok" : "warn"
      );
    });
  });

  function executeManualMove(move, skipAnim = false) {
    if (isAnimating || isPlaying) return;
    clearSolution();
    manualHistory.push(move);
    renderManualHistory();
    if (skipAnim) {
      cube.applyMove(move);
      if (paintMode) renderPaintNetAndCounts();
      if (cube.isSolved()) setStatus("🎉 方塊已還原！", "ok");
      return;
    }
    animateAndApply(move, () => {
      if (paintMode) renderPaintNetAndCounts();
      if (cube.isSolved()) setStatus("🎉 方塊已還原！", "ok");
    });
  }

  // Manual face turn buttons & keyboard shortcuts
  document.querySelectorAll("[data-move]").forEach((btn) => {
    btn.addEventListener("click", () => executeManualMove(btn.dataset.move));
  });

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === "INPUT" || isAnimating) return;
    if (e.code === "Space" && solutionSteps.length > 0) {
      e.preventDefault();
      btnPlay.click();
      return;
    }
    if (e.key === "ArrowRight" && !isPlaying && solutionSteps.length > 0) {
      e.preventDefault();
      stepForward(false);
      return;
    }
    if (e.key === "ArrowLeft" && !isPlaying && solutionSteps.length > 0) {
      e.preventDefault();
      stepBackward();
      return;
    }
    if (isPlaying) return;
    if (paintMode && e.key >= "1" && e.key <= "6") {
      selectSwatch(FACES[parseInt(e.key, 10) - 1]);
      return;
    }
    const key = e.key.toUpperCase();
    if (["U", "D", "L", "R", "F", "B", "M", "E", "S"].includes(key)) {
      executeManualMove(e.shiftKey ? `${key}'` : key);
    }
  });

  btnUndoManual.addEventListener("click", () => {
    if (isAnimating || isPlaying || manualHistory.length === 0) return;
    clearSolution();
    const last = manualHistory.pop();
    renderManualHistory();
    animateAndApply(invertMove(last), () => {
      setStatus(`↩️ 已撤銷 ${last}`, "info");
    });
  });

  btnClearHistory.addEventListener("click", () => {
    manualHistory = [];
    renderManualHistory();
  });

  document.getElementById("btn-reset-view").addEventListener("click", () => {
    renderer.yaw = -0.62;
    renderer.pitch = 0.48;
  });

  setStatus("💡 可按「🎲 隨機打亂」後點「🧠 開始求解」，或切換「🎨 手動填色」。", "info");
  updateActiveStepUI();
})();
