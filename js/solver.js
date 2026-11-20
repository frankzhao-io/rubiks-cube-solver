// Human-Readable 7-Stage Layer-by-Layer (LBL) 3x3x3 Rubik's Cube Solver
// Works on any valid cube state (bottom = D center color, top = U center color)

(function (global) {
  const { Cube, FACE_NORMALS } = global.CubeModel || require("./cube.js");

  const SIDES = ["F", "R", "B", "L"];
  const SIDE_XY = {
    F: [0, 0, 1],
    R: [1, 0, 0],
    B: [0, 0, -1],
    L: [-1, 0, 0],
  };

  function invertMove(m) {
    if (m.endsWith("2")) return m;
    if (m.endsWith("'")) return m[0];
    return m + "'";
  }

  function simplifyMoves(steps) {
    const out = [];
    for (const step of steps) {
      const m = step.move;
      const base = m[0];
      const q = m.endsWith("2") ? 2 : m.endsWith("'") ? 3 : 1;
      if (out.length > 0 && out[out.length - 1].move[0] === base) {
        const prev = out[out.length - 1];
        const pq = prev.move.endsWith("2") ? 2 : prev.move.endsWith("'") ? 3 : 1;
        const total = (pq + q) % 4;
        if (total === 0) {
          out.pop();
        } else {
          const mod = total === 1 ? "" : total === 2 ? "2" : "'";
          prev.move = base + mod;
        }
      } else {
        out.push({ ...step });
      }
    }
    return out;
  }

  function solveCubeLBL(inputCube) {
    const cube = inputCube.clone();
    const steps = [];

    if (cube.isSolved()) {
      return { ok: true, steps: [], phases: [] };
    }

    // Identify center colors
    const cU = cube.getStickerColor(0, 1, 0, "U");
    const cD = cube.getStickerColor(0, -1, 0, "D");
    const cSide = SIDES.map((f) => {
      const [x, y, z] = FACE_NORMALS[f];
      return cube.getStickerColor(x, y, z, f);
    });

    function mapLocalMove(slotIdx, localMove) {
      const base = localMove[0];
      const mod = localMove.slice(1);
      if (base === "U" || base === "D") return base + mod;
      const localIdx = SIDES.indexOf(base);
      const worldFace = SIDES[(slotIdx + localIdx) % 4];
      return worldFace + mod;
    }

    function pushMoves(slotIdx, localMoves, phase, desc) {
      for (const lm of localMoves) {
        const wm = mapLocalMove(slotIdx, lm);
        cube.applyMove(wm);
        steps.push({ move: wm, phase, desc });
      }
    }

    function pushWorldMoves(worldMoves, phase, desc) {
      for (const wm of worldMoves) {
        cube.applyMove(wm);
        steps.push({ move: wm, phase, desc });
      }
    }

    // ── Stage 1: 底層十字（D Cross） ──
    for (let s = 0; s < 4; s++) {
      const targetColor = cSide[s];
      const targetFace = SIDES[s];
      const [tx, , tz] = SIDE_XY[targetFace];

      const isCrossSolved = () =>
        cube.getStickerColor(tx, -1, tz, "D") === cD &&
        cube.getStickerColor(tx, -1, tz, targetFace) === targetColor;

      if (isCrossSolved()) continue;

      let cb = cube.findCubieByColors([cD, targetColor]);
      // If in D layer (not solved), lift it to U
      if (cb.pos[1] === -1) {
        const slot = SIDES.findIndex((f) => {
          const [fx, , fz] = SIDE_XY[f];
          return cb.pos[0] === fx && cb.pos[2] === fz;
        });
        pushMoves(slot, ["F2"], "1. 底層十字", `將 ${targetColor} 邊塊翻至頂層`);
      } else if (cb.pos[1] === 0) {
        // Middle layer: find which slot's F-R or F-L it sits in
        for (let k = 0; k < 4; k++) {
          const fFace = SIDES[k];
          const rFace = SIDES[(k + 1) % 4];
          const [fx, , fz] = SIDE_XY[fFace];
          const [rx, , rz] = SIDE_XY[rFace];
          if (cb.pos[0] === fx + rx && cb.pos[2] === fz + rz) {
            // Lift via R (if k+1 > s, or restore R' after U)
            pushMoves(k, ["R", "U", "R'"], "1. 底層十字", `將中層邊塊帶至頂層並復原底層`);
            break;
          }
        }
      }

      // Now edge is in U layer; rotate U until it sits above targetFace (s)
      cb = cube.findCubieByColors([cD, targetColor]);
      let guard = 0;
      while (!(cb.pos[0] === tx && cb.pos[2] === tz) && guard < 4) {
        pushWorldMoves(["U"], "1. 底層十字", `對齊 ${targetFace} 面中心`);
        cb = cube.findCubieByColors([cD, targetColor]);
        guard++;
      }

      const dFaceNow = cube.getColorFaceOnCubie(cb, cD);
      if (dFaceNow === "U") {
        pushMoves(s, ["F2"], "1. 底層十字", `直接翻下歸位底層十字`);
      } else {
        pushMoves(s, ["U'", "R'", "F", "R"], "1. 底層十字", `翻正並插入底層十字`);
      }
    }

    // ── Stage 2: 底層角塊（D Corners） ──
    for (let s = 0; s < 4; s++) {
      const fFace = SIDES[s];
      const rFace = SIDES[(s + 1) % 4];
      const cF = cSide[s];
      const cR = cSide[(s + 1) % 4];
      const [fx, , fz] = SIDE_XY[fFace];
      const [rx, , rz] = SIDE_XY[rFace];
      const cx = fx + rx;
      const cz = fz + rz;

      const isCornerSolved = () =>
        cube.getStickerColor(cx, -1, cz, "D") === cD &&
        cube.getStickerColor(cx, -1, cz, fFace) === cF &&
        cube.getStickerColor(cx, -1, cz, rFace) === cR;

      if (isCornerSolved()) continue;

      let cb = cube.findCubieByColors([cD, cF, cR]);
      if (cb.pos[1] === -1) {
        let inOwnSlot = false;
        for (let k = 0; k < 4; k++) {
          const [kfx, , kfz] = SIDE_XY[SIDES[k]];
          const [krx, , krz] = SIDE_XY[SIDES[(k + 1) % 4]];
          if (cb.pos[0] === kfx + krx && cb.pos[2] === kfz + krz) {
            if (k === s) {
              inOwnSlot = true;
            } else {
              pushMoves(k, ["R", "U", "R'"], "2. 底層角塊", `把錯位底角頂出至頂層`);
            }
            break;
          }
        }
        if (inOwnSlot) {
          let reps = 0;
          while (!isCornerSolved() && reps < 6) {
            pushMoves(s, ["R", "U", "R'", "U'"], "2. 底層角塊", `原地翻正底層角塊`);
            reps++;
          }
          continue;
        }
      }

      cb = cube.findCubieByColors([cD, cF, cR]);
      let guard = 0;
      while (!(cb.pos[0] === cx && cb.pos[2] === cz) && guard < 4) {
        pushWorldMoves(["U"], "2. 底層角塊", `將目標角塊移至槽位上方`);
        cb = cube.findCubieByColors([cD, cF, cR]);
        guard++;
      }

      const dDir = cube.getColorFaceOnCubie(cb, cD);
      if (dDir === fFace) {
        pushMoves(s, ["U", "R", "U'", "R'"], "2. 底層角塊", `底色朝前：用左手順序快速歸位`);
      } else if (dDir === "U") {
        pushMoves(s, ["R", "U2", "R'", "U'", "R", "U", "R'"], "2. 底層角塊", `底色朝上：一次轉正並歸位`);
      } else {
        pushMoves(s, ["R", "U", "R'", "U'"], "2. 底層角塊", `底色朝右：一次右手法歸位`);
      }
      let reps = 0;
      while (!isCornerSolved() && reps < 6) {
        pushMoves(s, ["R", "U", "R'", "U'"], "2. 底層角塊", `補齊底層角塊方向`);
        reps++;
      }
    }

    // ── Stage 3: 中層邊塊（Middle Layer Edges） ──
    for (let s = 0; s < 4; s++) {
      const fFace = SIDES[s];
      const rFace = SIDES[(s + 1) % 4];
      const cF = cSide[s];
      const cR = cSide[(s + 1) % 4];
      const [fx, , fz] = SIDE_XY[fFace];
      const [rx, , rz] = SIDE_XY[rFace];
      const mx = fx + rx;
      const mz = fz + rz;

      const isMidSolved = () =>
        cube.getStickerColor(mx, 0, mz, fFace) === cF &&
        cube.getStickerColor(mx, 0, mz, rFace) === cR;

      if (isMidSolved()) continue;

      let cb = cube.findCubieByColors([cF, cR]);
      if (cb.pos[1] === 0) {
        for (let k = 0; k < 4; k++) {
          const [kfx, , kfz] = SIDE_XY[SIDES[k]];
          const [krx, , krz] = SIDE_XY[SIDES[(k + 1) % 4]];
          if (cb.pos[0] === kfx + krx && cb.pos[2] === kfz + krz) {
            pushMoves(k, ["R", "U'", "R'", "U'", "F'", "U", "F"], "3. 中層邊塊", `將中層錯位邊塊頂出至頂層`);
            break;
          }
        }
      }

      cb = cube.findCubieByColors([cF, cR]);
      const uColor = cube.getColorFaceOnCubie(cb, cF) === "U" ? cR : cF;
      const matchSlot = cSide.indexOf(uColor);
      const [msx, , msz] = SIDE_XY[SIDES[matchSlot]];

      let guard = 0;
      while (!(cb.pos[0] === msx && cb.pos[2] === msz) && guard < 4) {
        pushWorldMoves(["U"], "3. 中層邊塊", `將中層邊塊對齊側面中心`);
        cb = cube.findCubieByColors([cF, cR]);
        guard++;
      }

      if (matchSlot === s) {
        pushMoves(matchSlot, ["U", "R", "U'", "R'", "U'", "F'", "U", "F"], "3. 中層邊塊", `中層右插公式`);
      } else {
        pushMoves(matchSlot, ["U'", "L'", "U", "L", "U", "F", "U'", "F'"], "3. 中層邊塊", `中層左插公式`);
      }
    }

    // ── Stage 4: 頂層十字（U Cross） ──
    const getUEdgeFlags = () =>
      SIDES.map((f) => {
        const [x, , z] = SIDE_XY[f];
        return cube.getStickerColor(x, 1, z, "U") === cU;
      });

    let safety = 0;
    while (getUEdgeFlags().filter(Boolean).length < 4 && safety < 4) {
      const flags = getUEdgeFlags();
      const count = flags.filter(Boolean).length;
      if (count === 0) {
        pushMoves(0, ["F", "R", "U", "R'", "U'", "F'"], "4. 頂層十字", `點狀：執行 F R U R' U' F'`);
      } else if (count === 2) {
        // Check opposite (Line) vs adjacent (L)
        if (flags[0] && flags[2]) {
          pushWorldMoves(["U"], "4. 頂層十字", `將一字轉為橫向`);
        } else if (flags[1] && flags[3]) {
          // Already horizontal (L and R)
        } else {
          // L-shape: rotate U until flags[2] (B) and flags[3] (L) are true
          let g = 0;
          while (!(getUEdgeFlags()[2] && getUEdgeFlags()[3]) && g < 4) {
            pushWorldMoves(["U"], "4. 頂層十字", `將 L 型轉至左上角（9點/12點）`);
            g++;
          }
        }
        pushMoves(0, ["F", "R", "U", "R'", "U'", "F'"], "4. 頂層十字", `執行頂層十字公式`);
      }
      safety++;
    }

    // ── Stage 5: 頂層角塊翻正（Orient U Corners via R' D' R D） ──
    const ufrOriented = () => cube.getStickerColor(1, 1, 1, "U") === cU;
    const allUCornersOriented = () =>
      cube.getStickerColor(1, 1, 1, "U") === cU &&
      cube.getStickerColor(1, 1, -1, "U") === cU &&
      cube.getStickerColor(-1, 1, 1, "U") === cU &&
      cube.getStickerColor(-1, 1, -1, "U") === cU;

    if (!allUCornersOriented()) {
      for (let i = 0; i < 4; i++) {
        if (!ufrOriented()) {
          const uDir = cube.getColorFaceOnCubie(cube.getCubieAt(1, 1, 1), cU);
          const seq = uDir === "F" ? ["D'", "R'", "D", "R"] : ["R'", "D'", "R", "D"];
          const label = uDir === "F" ? "D' R' D R" : "R' D' R D";
          let reps = 0;
          while (!ufrOriented() && reps < 6) {
            pushMoves(0, seq, "5. 頂層翻角", `使用 ${label} 翻正右上角塊`);
            reps++;
          }
        }
        if (allUCornersOriented()) break;
        pushWorldMoves(["U"], "5. 頂層翻角", `只轉頂層，換下一個未翻正角塊`);
      }
    }

    // ── Stage 6: 頂層角塊歸位（Permute U Corners） ──
    const countMatchingCorners = () => {
      let m = 0;
      for (let s = 0; s < 4; s++) {
        const f1 = SIDES[s];
        const f2 = SIDES[(s + 1) % 4];
        const [x1, , z1] = SIDE_XY[f1];
        const [x2, , z2] = SIDE_XY[f2];
        if (
          cube.getStickerColor(x1 + x2, 1, z1 + z2, f1) === cSide[s] &&
          cube.getStickerColor(x1 + x2, 1, z1 + z2, f2) === cSide[(s + 1) % 4]
        ) {
          m++;
        }
      }
      return m;
    };

    const alignBestU = () => {
      let bestU = 0, bestM = -1;
      for (let u = 0; u < 4; u++) {
        const m = countMatchingCorners();
        if (m > bestM) { bestM = m; bestU = u; }
        cube.applyMove("U");
      }
      for (let u = 0; u < bestU; u++) pushWorldMoves(["U"], "6. 頂層角塊歸位", `對齊頂層角塊`);
    };

    alignBestU();
    let cGuard = 0;
    while (countMatchingCorners() < 4 && cGuard < 4) {
      // Find headlights (two corners on same side sharing side color) and put on Back (B)
      let headlightSlot = -1;
      for (let s = 0; s < 4; s++) {
        const f = SIDES[s];
        const r = SIDES[(s + 1) % 4];
        const l = SIDES[(s + 3) % 4];
        const [fx, , fz] = SIDE_XY[f];
        const [rx, , rz] = SIDE_XY[r];
        const [lx, , lz] = SIDE_XY[l];
        if (cube.getStickerColor(fx + rx, 1, fz + rz, f) === cube.getStickerColor(fx + lx, 1, fz + lz, f)) {
          headlightSlot = s;
          break;
        }
      }
      const runSlot = headlightSlot === -1 ? 0 : (headlightSlot + 2) % 4;
      pushMoves(
        runSlot,
        ["R'", "F", "R'", "B2", "R", "F'", "R'", "B2", "R2"],
        "6. 頂層角塊歸位",
        `執行三角換（Aa-Perm）對齊頂層角塊`
      );
      alignBestU();
      cGuard++;
    }

    // ── Stage 7: 頂層邊塊歸位（Permute U Edges） ──
    const isEdgeSolvedAt = (s) => {
      const f = SIDES[s];
      const [x, , z] = SIDE_XY[f];
      return cube.getStickerColor(x, 1, z, f) === cSide[s];
    };

    const UA_PERM = ["R2", "U", "R", "U", "R'", "U'", "R'", "U'", "R'", "U", "R'"];
    const UB_PERM = ["R", "U'", "R", "U", "R", "U", "R", "U'", "R'", "U'", "R2"];

    let eGuard = 0;
    while (!cube.isSolved() && eGuard < 4) {
      let solvedSlot = -1;
      for (let s = 0; s < 4; s++) {
        if (isEdgeSolvedAt(s)) { solvedSlot = s; break; }
      }
      const runSlot = solvedSlot === -1 ? 0 : (solvedSlot + 2) % 4;
      // Pick Ua vs Ub if one solves the cube immediately
      let chosen = UB_PERM;
      let label = "Ub-Perm";
      if (solvedSlot !== -1) {
        const testUa = cube.clone();
        for (const lm of UA_PERM) testUa.applyMove(mapLocalMove(runSlot, lm));
        if (testUa.isSolved()) { chosen = UA_PERM; label = "Ua-Perm"; }
      }
      pushMoves(runSlot, chosen, "7. 頂層邊塊歸位", `執行三邊輪換（${label}）完成還原`);
      eGuard++;
    }

    const simplified = simplifyMoves(steps);
    return {
      ok: cube.isSolved(),
      steps: simplified,
    };
  }

  global.CubeSolver = { solveCubeLBL, simplifyMoves, invertMove };
  if (typeof module !== "undefined" && module.exports) module.exports = global.CubeSolver;
})(typeof window !== "undefined" ? window : globalThis);
