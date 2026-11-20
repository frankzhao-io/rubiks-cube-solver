// Speedcubing CFOP (Cross + F2L + 2-Look OLL + 2-Look PLL) Solver
// Produces ~55-80 move solutions with named algorithms (Sune, T-Perm, Ua-Perm, etc.)

(function (global) {
  const { Cube, FACE_NORMALS } = global.CubeModel || require("./cube.js");
  const { simplifyMoves } = global.CubeSolver || require("./solver.js");

  const SIDES = ["F", "R", "B", "L"];
  const SIDE_XY = {
    F: [0, 0, 1],
    R: [1, 0, 0],
    B: [0, 0, -1],
    L: [-1, 0, 0],
  };

  function solveCubeCFOP(inputCube) {
    const cube = inputCube.clone();
    const steps = [];

    if (cube.isSolved()) {
      return { ok: true, steps: [] };
    }

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
      return SIDES[(slotIdx + localIdx) % 4] + mod;
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

    // ── Stage 1: Optimal D-Cross via short IDA* (<= 7 moves) ──
    const isAllCrossSolved = (cb) => {
      for (let s = 0; s < 4; s++) {
        const f = SIDES[s];
        const [x, , z] = SIDE_XY[f];
        if (cb.getStickerColor(x, -1, z, "D") !== cD || cb.getStickerColor(x, -1, z, f) !== cSide[s]) {
          return false;
        }
      }
      return true;
    };

    if (!isAllCrossSolved(cube)) {
      const ALL_18 = ["U", "U2", "U'", "D", "D2", "D'", "R", "R2", "R'", "L", "L2", "L'", "F", "F2", "F'", "B", "B2", "B'"];
      const OPP = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
      let crossSol = null;
      const tCross0 = performance.now();

      const dfsCross = (cb, depth, lastBase, path) => {
        if (performance.now() - tCross0 > 60) return false;
        if (depth === 0) return isAllCrossSolved(cb);
        for (const m of ALL_18) {
          const base = m[0];
          if (base === lastBase || OPP[base] === lastBase && base < lastBase) continue;
          const nxt = cb.clone();
          nxt.applyMove(m);
          path.push(m);
          if (dfsCross(nxt, depth - 1, base, path)) return true;
          path.pop();
        }
        return false;
      };

      for (let d = 1; d <= 6; d++) {
        const path = [];
        if (dfsCross(cube, d, "", path)) {
          crossSol = path;
          break;
        }
        if (performance.now() - tCross0 > 60) break;
      }

      if (crossSol) {
        pushWorldMoves(crossSol, "1. 最佳底層十字（Cross）", `以 ${crossSol.length} 步完成底層十字`);
      } else {
        // Fallback: solve remaining cross edges cleanly
        for (let s = 0; s < 4; s++) {
          const targetColor = cSide[s];
          const targetFace = SIDES[s];
          const [tx, , tz] = SIDE_XY[targetFace];
          if (cube.getStickerColor(tx, -1, tz, "D") === cD && cube.getStickerColor(tx, -1, tz, targetFace) === targetColor) continue;
          let cb = cube.findCubieByColors([cD, targetColor]);
          if (cb.pos[1] === -1) {
            const slot = SIDES.findIndex((f) => {
              const [fx, , fz] = SIDE_XY[f];
              return cb.pos[0] === fx && cb.pos[2] === fz;
            });
            pushMoves(slot, ["F2"], "1. 最佳底層十字（Cross）", `將 ${targetColor} 邊塊翻至頂層`);
          } else if (cb.pos[1] === 0) {
            for (let k = 0; k < 4; k++) {
              const [fx, , fz] = SIDE_XY[SIDES[k]];
              const [rx, , rz] = SIDE_XY[SIDES[(k + 1) % 4]];
              if (cb.pos[0] === fx + rx && cb.pos[2] === fz + rz) {
                pushMoves(k, ["R", "U", "R'"], "1. 最佳底層十字（Cross）", `將中層邊塊帶至頂層`);
                break;
              }
            }
          }
          cb = cube.findCubieByColors([cD, targetColor]);
          let guard = 0;
          while (!(cb.pos[0] === tx && cb.pos[2] === tz) && guard < 4) {
            pushWorldMoves(["U"], "1. 最佳底層十字（Cross）", `對齊 ${targetFace} 面中心`);
            cb = cube.findCubieByColors([cD, targetColor]);
            guard++;
          }
          if (cube.getColorFaceOnCubie(cb, cD) === "U") {
            pushMoves(s, ["F2"], "1. 最佳底層十字（Cross）", `直接翻下歸位`);
          } else {
            pushMoves(s, ["U'", "R'", "F", "R"], "1. 最佳底層十字（Cross）", `翻正插入十字`);
          }
        }
      }
    }

    // ── Stage 2: F2L (4 Corner-Edge Pairs) ──
    const U_ALIGNS = [[], ["U"], ["U2"], ["U'"]];
    const F2L_TRIGGERS = [
      ["R", "U", "R'"],
      ["R", "U'", "R'"],
      ["R", "U2", "R'"],
      ["F'", "U'", "F"],
      ["F'", "U", "F"],
      ["F'", "U2", "F"],
    ];

    for (let s = 0; s < 4; s++) {
      const fFace = SIDES[s];
      const rFace = SIDES[(s + 1) % 4];
      const cF = cSide[s];
      const cR = cSide[(s + 1) % 4];
      const [fx, , fz] = SIDE_XY[fFace];
      const [rx, , rz] = SIDE_XY[rFace];
      const sx = fx + rx;
      const sz = fz + rz;

      const isPairSolved = (cb) =>
        cb.getStickerColor(sx, -1, sz, "D") === cD &&
        cb.getStickerColor(sx, -1, sz, fFace) === cF &&
        cb.getStickerColor(sx, -1, sz, rFace) === cR &&
        cb.getStickerColor(sx, 0, sz, fFace) === cF &&
        cb.getStickerColor(sx, 0, sz, rFace) === cR;

      if (isPairSolved(cube)) continue;

      // Pop corner or edge out of D/middle layer into U layer if needed
      let corner = cube.findCubieByColors([cD, cF, cR]);
      if (corner.pos[1] === -1) {
        for (let k = 0; k < 4; k++) {
          const [kfx, , kfz] = SIDE_XY[SIDES[k]];
          const [krx, , krz] = SIDE_XY[SIDES[(k + 1) % 4]];
          if (corner.pos[0] === kfx + krx && corner.pos[2] === kfz + krz) {
            pushMoves(k, ["R", "U", "R'"], "2. F2L 前兩層配對", `將第 ${s + 1} 組角塊頂出至頂層`);
            break;
          }
        }
      }
      let edge = cube.findCubieByColors([cF, cR]);
      if (edge.pos[1] === 0) {
        for (let k = 0; k < 4; k++) {
          const [kfx, , kfz] = SIDE_XY[SIDES[k]];
          const [krx, , krz] = SIDE_XY[SIDES[(k + 1) % 4]];
          if (edge.pos[0] === kfx + krx && edge.pos[2] === kfz + krz) {
            pushMoves(k, ["R", "U", "R'"], "2. F2L 前兩層配對", `將第 ${s + 1} 組邊塊頂出至頂層`);
            break;
          }
        }
      }
      // In case popping edge put corner back in D, pop once more
      corner = cube.findCubieByColors([cD, cF, cR]);
      if (corner.pos[1] === -1) {
        for (let k = 0; k < 4; k++) {
          const [kfx, , kfz] = SIDE_XY[SIDES[k]];
          const [krx, , krz] = SIDE_XY[SIDES[(k + 1) % 4]];
          if (corner.pos[0] === kfx + krx && corner.pos[2] === kfz + krz) {
            pushMoves(k, ["R", "U'", "R'"], "2. F2L 前兩層配對", `分離第 ${s + 1} 組角塊至頂層`);
            break;
          }
        }
      }

      // Search 1-trigger or 2-trigger F2L insertion on slot s
      let foundF2L = null;
      for (const u1 of U_ALIGNS) {
        for (const t1 of F2L_TRIGGERS) {
          const seq1 = [...u1, ...t1];
          const test1 = cube.clone();
          for (const lm of seq1) test1.applyMove(mapLocalMove(s, lm));
          if (isPairSolved(test1)) {
            foundF2L = seq1;
            break;
          }
        }
        if (foundF2L) break;
      }

      if (!foundF2L) {
        outer: for (const u1 of U_ALIGNS) {
          for (const t1 of F2L_TRIGGERS) {
            const test1 = cube.clone();
            for (const lm of [...u1, ...t1]) test1.applyMove(mapLocalMove(s, lm));
            for (const u2 of U_ALIGNS) {
              for (const t2 of F2L_TRIGGERS) {
                const test2 = test1.clone();
                for (const lm of [...u2, ...t2]) test2.applyMove(mapLocalMove(s, lm));
                if (isPairSolved(test2)) {
                  foundF2L = [...u1, ...t1, ...u2, ...t2];
                  break outer;
                }
              }
            }
          }
        }
      }

      if (foundF2L) {
        pushMoves(s, foundF2L, "2. F2L 前兩層配對", `配對並同時插入第 ${s + 1} 組 F2L 槽位`);
      } else {
        // Rare 3-trigger fallback: solve corner then edge
        outer3: for (const u1 of U_ALIGNS) {
          for (const t1 of F2L_TRIGGERS) {
            const test1 = cube.clone();
            for (const lm of [...u1, ...t1]) test1.applyMove(mapLocalMove(s, lm));
            for (const u2 of U_ALIGNS) {
              for (const t2 of F2L_TRIGGERS) {
                const test2 = test1.clone();
                for (const lm of [...u2, ...t2]) test2.applyMove(mapLocalMove(s, lm));
                for (const u3 of U_ALIGNS) {
                  for (const t3 of F2L_TRIGGERS) {
                    const test3 = test2.clone();
                    for (const lm of [...u3, ...t3]) test3.applyMove(mapLocalMove(s, lm));
                    if (isPairSolved(test3)) {
                      foundF2L = [...u1, ...t1, ...u2, ...t2, ...u3, ...t3];
                      break outer3;
                    }
                  }
                }
              }
            }
          }
        }
        if (foundF2L) {
          pushMoves(s, foundF2L, "2. F2L 前兩層配對", `三段式配對插入第 ${s + 1} 組 F2L`);
        } else {
          // Fallback: solve corner then middle edge for slot s
          let cb = cube.findCubieByColors([cD, cF, cR]);
          let guard = 0;
          while (!(cb.pos[0] === sx && cb.pos[2] === sz) && guard < 4) {
            pushWorldMoves(["U"], "2. F2L 前兩層配對", `對齊第 ${s + 1} 組角塊`);
            cb = cube.findCubieByColors([cD, cF, cR]);
            guard++;
          }
          let reps = 0;
          while (
            !(
              cube.getStickerColor(sx, -1, sz, "D") === cD &&
              cube.getStickerColor(sx, -1, sz, fFace) === cF &&
              cube.getStickerColor(sx, -1, sz, rFace) === cR
            ) &&
            reps < 6
          ) {
            pushMoves(s, ["R", "U", "R'", "U'"], "2. F2L 前兩層配對", `歸位第 ${s + 1} 組底角`);
            reps++;
          }
          let eb = cube.findCubieByColors([cF, cR]);
          if (eb.pos[1] === 0) {
            for (let k = 0; k < 4; k++) {
              const [kfx, , kfz] = SIDE_XY[SIDES[k]];
              const [krx, , krz] = SIDE_XY[SIDES[(k + 1) % 4]];
              if (eb.pos[0] === kfx + krx && eb.pos[2] === kfz + krz) {
                pushMoves(k, ["R", "U'", "R'", "U'", "F'", "U", "F"], "2. F2L 前兩層配對", `頂出第 ${s + 1} 組邊塊`);
                break;
              }
            }
          }
          eb = cube.findCubieByColors([cF, cR]);
          const uColor = cube.getColorFaceOnCubie(eb, cF) === "U" ? cR : cF;
          const matchSlot = cSide.indexOf(uColor);
          const [msx, , msz] = SIDE_XY[SIDES[matchSlot]];
          let eg = 0;
          while (!(eb.pos[0] === msx && eb.pos[2] === msz) && eg < 4) {
            pushWorldMoves(["U"], "2. F2L 前兩層配對", `對齊第 ${s + 1} 組中層邊塊`);
            eb = cube.findCubieByColors([cF, cR]);
            eg++;
          }
          if (matchSlot === s) {
            pushMoves(matchSlot, ["U", "R", "U'", "R'", "U'", "F'", "U", "F"], "2. F2L 前兩層配對", `插入第 ${s + 1} 組中層邊塊`);
          } else {
            pushMoves(matchSlot, ["U'", "L'", "U", "L", "U", "F", "U'", "F'"], "2. F2L 前兩層配對", `插入第 ${s + 1} 組中層邊塊`);
          }
        }
      }
    }

    // ── Stage 3: 2-Look OLL ──
    const getUEdgeFlags = () =>
      SIDES.map((f) => {
        const [x, , z] = SIDE_XY[f];
        return cube.getStickerColor(x, 1, z, "U") === cU;
      });

    let ollSafety = 0;
    while (getUEdgeFlags().filter(Boolean).length < 4 && ollSafety < 3) {
      const flags = getUEdgeFlags();
      const count = flags.filter(Boolean).length;
      if (count === 0) {
        pushMoves(0, ["F", "R", "U", "R'", "U'", "F'"], "3. 2-Look OLL（頂面朝向）", `點狀：F R U R' U' F'`);
      } else if (count === 2) {
        if (flags[0] && flags[2]) {
          pushWorldMoves(["U"], "3. 2-Look OLL（頂面朝向）", `將一字轉為橫向`);
          pushMoves(0, ["F", "R", "U", "R'", "U'", "F'"], "3. 2-Look OLL（頂面朝向）", `一字型：F R U R' U' F'`);
        } else if (flags[1] && flags[3]) {
          pushMoves(0, ["F", "R", "U", "R'", "U'", "F'"], "3. 2-Look OLL（頂面朝向）", `一字型：F R U R' U' F'`);
        } else {
          // L-shape: align to back-left (2 and 3) and use F U R U' R' F'
          let g = 0;
          while (!(getUEdgeFlags()[2] && getUEdgeFlags()[3]) && g < 4) {
            pushWorldMoves(["U"], "3. 2-Look OLL（頂面朝向）", `對齊 L 型至左上角（9點/12點）`);
            g++;
          }
          pushMoves(0, ["F", "U", "R", "U'", "R'", "F'"], "3. 2-Look OLL（頂面朝向）", `L 型：F U R U' R' F'`);
        }
      }
      ollSafety++;
    }

    const isAllUOriented = (cb) => {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          if (cb.getStickerColor(x, 1, z, "U") !== cU) return false;
        }
      }
      return true;
    };

    if (!isAllUOriented(cube)) {
      const OCLL_CASES = [
        { name: "Sune（小魚順）", moves: ["R", "U", "R'", "U", "R", "U2", "R'"] },
        { name: "Anti-Sune（小魚逆）", moves: ["R", "U2", "R'", "U'", "R", "U'", "R'"] },
        { name: "H（雙魚）", moves: ["R", "U", "R'", "U", "R", "U'", "R'", "U", "R", "U2", "R'"] },
        { name: "Pi（派型）", moves: ["R", "U2", "R2", "U'", "R2", "U'", "R2", "U2", "R"] },
        { name: "U（雙眼）", moves: ["R2", "D", "R'", "U2", "R", "D'", "R'", "U2", "R'"] },
        { name: "T（變色龍）", moves: ["L", "F", "R'", "F'", "L'", "F", "R", "F'"] },
        { name: "L（蝴蝶結）", moves: ["F", "R'", "F'", "L", "F", "R", "F'", "L'"] },
      ];
      // Verify T and L: try each OCLL across 4 slots
      let solvedOll = false;
      for (const oc of OCLL_CASES) {
        for (let s = 0; s < 4; s++) {
          const test = cube.clone();
          for (const lm of oc.moves) test.applyMove(mapLocalMove(s, lm));
          if (isAllUOriented(test)) {
            pushMoves(s, oc.moves, "3. 2-Look OLL（頂面朝向）", `執行 OCLL：${oc.name}`);
            solvedOll = true;
            break;
          }
        }
        if (solvedOll) break;
      }
      if (!solvedOll) {
        // Fallback: 2-step Sune if an edge-case OCLL wasn't matched
        for (let guard = 0; guard < 3 && !isAllUOriented(cube); guard++) {
          pushMoves(0, ["R", "U", "R'", "U", "R", "U2", "R'"], "3. 2-Look OLL（頂面朝向）", `Sune 調整頂面朝向`);
        }
      }
    }

    // ── Stage 4: 2-Look PLL ──
    const cornersPermuted = (cb) => {
      for (let s = 0; s < 4; s++) {
        const f1 = SIDES[s];
        const f2 = SIDES[(s + 1) % 4];
        const [x1, , z1] = SIDE_XY[f1];
        const [x2, , z2] = SIDE_XY[f2];
        const [rx1, , rz1] = SIDE_XY[SIDES[(s + 3) % 4]];
        if (cb.getStickerColor(x1 + x2, 1, z1 + z2, f1) !== cb.getStickerColor(x1 + rx1, 1, z1 + rz1, f1)) {
          return false;
        }
      }
      return true;
    };

    if (!cornersPermuted(cube)) {
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
      if (headlightSlot !== -1) {
        // Put headlights on Left: (headlightSlot + 1) % 4 has Left = headlightSlot
        const runSlot = (headlightSlot + 1) % 4;
        pushMoves(
          runSlot,
          ["R", "U", "R'", "U'", "R'", "F", "R2", "U'", "R'", "U'", "R", "U", "R'", "F'"],
          "4. 2-Look PLL（頂層歸位）",
          `執行 T-Perm 對齊四角`
        );
      } else {
        pushMoves(
          0,
          ["F", "R", "U'", "R'", "U'", "R", "U", "R'", "F'", "R", "U", "R'", "U'", "R'", "F", "R", "F'"],
          "4. 2-Look PLL（頂層歸位）",
          `執行 Y-Perm 對角換角`
        );
      }
    }

    // Align U corners before EPLL
    let auf = 0;
    const isCornerAligned = (cb) => {
      const [fx, , fz] = SIDE_XY.F;
      const [rx, , rz] = SIDE_XY.R;
      return cb.getStickerColor(fx + rx, 1, fz + rz, "F") === cSide[0];
    };
    while (!isCornerAligned(cube) && auf < 4) {
      pushWorldMoves(["U"], "4. 2-Look PLL（頂層歸位）", `對齊頂層角塊`);
      auf++;
    }

    if (!cube.isSolved()) {
      const EPLL_CASES = [
        { name: "Ua-Perm（三邊逆時針）", moves: ["R2", "U", "R", "U", "R'", "U'", "R'", "U'", "R'", "U", "R'"] },
        { name: "Ub-Perm（三邊順時針）", moves: ["R", "U'", "R", "U", "R", "U", "R", "U'", "R'", "U'", "R2"] },
        { name: "H-Perm（對邊互換）", moves: ["R2", "U2", "R", "U2", "R2", "U2", "R2", "U2", "R", "U2", "R2"] },
        { name: "Z-Perm（鄰邊互換）", moves: ["R'", "U'", "R", "U'", "R", "U", "R", "U'", "R'", "U", "R", "U", "R2", "U'", "R'", "U2"] },
      ];
      let solvedEpll = false;
      for (const ep of EPLL_CASES) {
        for (let s = 0; s < 4; s++) {
          const test = cube.clone();
          for (const lm of ep.moves) test.applyMove(mapLocalMove(s, lm));
          if (test.isSolved()) {
            pushMoves(s, ep.moves, "4. 2-Look PLL（頂層歸位）", `執行 ${ep.name}`);
            solvedEpll = true;
            break;
          }
        }
        if (solvedEpll) break;
      }
    }

    const simplified = simplifyMoves(steps);
    return {
      ok: cube.isSolved(),
      steps: simplified,
    };
  }

  global.CubeCFOPSolver = { solveCubeCFOP };
  if (typeof module !== "undefined" && module.exports) module.exports = global.CubeCFOPSolver;
})(typeof window !== "undefined" ? window : globalThis);
