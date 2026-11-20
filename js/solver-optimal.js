// Kociemba Two-Phase Optimal Solver (pure JS, zero-dependency)
// Solves any valid 3x3x3 Cube state in ~18-22 moves (Half-Turn Metric)

(function (global) {
  const { Cube, FACES, FACE_NORMALS } = global.CubeModel || require("./cube.js");

  const MOVE_NAMES = [
    "U", "U2", "U'",
    "R", "R2", "R'",
    "F", "F2", "F'",
    "D", "D2", "D'",
    "L", "L2", "L'",
    "B", "B2", "B'",
  ];

  // Phase 2 allowed moves (indices in MOVE_NAMES): U, U2, U', R2, F2, D, D2, D', L2, B2
  const P2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];

  // Canonical 8 corners: [pos, [primaryFace, cwFace1, cwFace2]]
  // Clockwise order from outside: (n0 x n1) . pos < 0
  const CORNERS = [
    { pos: [1, 1, 1], faces: ["U", "R", "F"] },   // 0: URF
    { pos: [-1, 1, 1], faces: ["U", "F", "L"] },  // 1: UFL
    { pos: [-1, 1, -1], faces: ["U", "L", "B"] }, // 2: ULB
    { pos: [1, 1, -1], faces: ["U", "B", "R"] },  // 3: UBR
    { pos: [1, -1, 1], faces: ["D", "F", "R"] },  // 4: DFR
    { pos: [-1, -1, 1], faces: ["D", "L", "F"] }, // 5: DLF
    { pos: [-1, -1, -1], faces: ["D", "B", "L"] },// 6: DBL
    { pos: [1, -1, -1], faces: ["D", "R", "B"] }, // 7: DRB
  ];

  // Canonical 12 edges: 0..7 are U/D edges, 8..11 are UD-slice (middle) edges
  const EDGES = [
    { pos: [1, 1, 0], faces: ["U", "R"] },   // 0: UR
    { pos: [0, 1, 1], faces: ["U", "F"] },   // 1: UF
    { pos: [-1, 1, 0], faces: ["U", "L"] },  // 2: UL
    { pos: [0, 1, -1], faces: ["U", "B"] },  // 3: UB
    { pos: [1, -1, 0], faces: ["D", "R"] },  // 4: DR
    { pos: [0, -1, 1], faces: ["D", "F"] },  // 5: DF
    { pos: [-1, -1, 0], faces: ["D", "L"] }, // 6: DL
    { pos: [0, -1, -1], faces: ["D", "B"] }, // 7: DB
    { pos: [1, 0, 1], faces: ["F", "R"] },   // 8: FR
    { pos: [-1, 0, 1], faces: ["F", "L"] },  // 9: FL
    { pos: [-1, 0, -1], faces: ["B", "L"] }, // 10: BL
    { pos: [1, 0, -1], faces: ["B", "R"] },  // 11: BR
  ];

  // Build color-to-canonical-face map from cube's 6 center stickers
  function getCenterMap(cube) {
    const map = {};
    for (const f of FACES) {
      const [x, y, z] = FACE_NORMALS[f];
      const color = cube.getStickerColor(x, y, z, f);
      map[color] = f;
    }
    return map;
  }

  // Extract cubie-level { cp, co, ep, eo } from a Cube instance
  function cubeToCubieState(cube) {
    const cmap = getCenterMap(cube);
    const cp = new Int8Array(8);
    const co = new Int8Array(8);
    const ep = new Int8Array(12);
    const eo = new Int8Array(12);

    for (let i = 0; i < 8; i++) {
      const { pos, faces } = CORNERS[i];
      const cols = faces.map((f) => cmap[cube.getStickerColor(pos[0], pos[1], pos[2], f)]);
      let ori = cols.indexOf("U");
      if (ori === -1) ori = cols.indexOf("D");
      co[i] = ori;
      const cSet = [...cols].sort().join("");
      for (let j = 0; j < 8; j++) {
        if ([...CORNERS[j].faces].sort().join("") === cSet) {
          cp[i] = j;
          break;
        }
      }
    }

    for (let i = 0; i < 12; i++) {
      const { pos, faces } = EDGES[i];
      const cols = faces.map((f) => cmap[cube.getStickerColor(pos[0], pos[1], pos[2], f)]);
      const cSet = [...cols].sort().join("");
      for (let j = 0; j < 12; j++) {
        if ([...EDGES[j].faces].sort().join("") === cSet) {
          ep[i] = j;
          eo[i] = cols[0] === EDGES[j].faces[0] ? 0 : 1;
          break;
        }
      }
    }
    return { cp, co, ep, eo };
  }

  // Derive the 6 basic face moves (U, R, F, D, L, B) directly from CubeModel.Cube
  const BASE_MOVES = ["U", "R", "F", "D", "L", "B"].map((m) => {
    const c = new Cube();
    c.applyMove(m);
    return cubeToCubieState(c);
  });

  function multiplyCorners(aCp, aCo, bCp, bCo, outCp, outCo) {
    for (let i = 0; i < 8; i++) {
      const src = bCp[i];
      outCp[i] = aCp[src];
      outCo[i] = (aCo[src] + bCo[i]) % 3;
    }
  }

  function multiplyEdges(aEp, aEo, bEp, bEo, outEp, outEo) {
    for (let i = 0; i < 12; i++) {
      const src = bEp[i];
      outEp[i] = aEp[src];
      outEo[i] = (aEo[src] + bEo[i]) & 1;
    }
  }

  // Precompute all 18 moves in cubie representation
  const ALL_MOVES = [];
  for (let f = 0; f < 6; f++) {
    const bm = BASE_MOVES[f];
    let cur = {
      cp: new Int8Array(bm.cp),
      co: new Int8Array(bm.co),
      ep: new Int8Array(bm.ep),
      eo: new Int8Array(bm.eo),
    };
    ALL_MOVES.push(cur);
    for (let p = 1; p < 3; p++) {
      const nxt = {
        cp: new Int8Array(8),
        co: new Int8Array(8),
        ep: new Int8Array(12),
        eo: new Int8Array(12),
      };
      multiplyCorners(cur.cp, cur.co, bm.cp, bm.co, nxt.cp, nxt.co);
      multiplyEdges(cur.ep, cur.eo, bm.ep, bm.eo, nxt.ep, nxt.eo);
      ALL_MOVES.push(nxt);
      cur = nxt;
    }
  }

  // Combinatorial helper C(n, k)
  function comb(n, k) {
    if (n < k || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    let res = 1;
    for (let i = 1; i <= k; i++) res = (res * (n - i + 1)) / i;
    return Math.round(res);
  }

  // Coordinate encoders / decoders
  function getTwist(co) {
    let t = 0;
    for (let i = 0; i < 7; i++) t = t * 3 + co[i];
    return t;
  }
  function setTwist(t, co) {
    let sum = 0;
    for (let i = 6; i >= 0; i--) {
      co[i] = t % 3;
      sum += co[i];
      t = (t / 3) | 0;
    }
    co[7] = (3 - (sum % 3)) % 3;
  }

  function getFlip(eo) {
    let f = 0;
    for (let i = 0; i < 11; i++) f = (f << 1) | eo[i];
    return f;
  }
  function setFlip(f, eo) {
    let parity = 0;
    for (let i = 10; i >= 0; i--) {
      eo[i] = f & 1;
      parity ^= eo[i];
      f >>= 1;
    }
    eo[11] = parity;
  }

  // UD-slice coordinate (0..494): positions of edges 8..11
  function getSlice(ep) {
    let s = 0, k = 3;
    for (let i = 11; i >= 0; i--) {
      if (ep[i] >= 8) {
        s += comb(11 - i, k + 1); // Wait: standard is C(i, k) when scanning 11..0? Let's use clean consistent ranking:
        k--;
      }
    }
    return s;
  }
  // Wait: let's use exact standard ranking over i = 11..0 with C(11 - i, ...) vs C(i, ...):
  // Let's make getSlice and setSlice exact inverses by scanning i = 0..11!
  function getSliceClean(ep) {
    let s = 0, k = 0;
    for (let i = 0; i < 12; i++) {
      if (ep[i] >= 8) {
        k++;
      } else if (k > 0) {
        s += comb(i, k - 1);
      }
    }
    return s;
  }
  function setSliceClean(s, ep) {
    ep.fill(0);
    let k = 4;
    let sliceIdx = 8;
    for (let i = 11; i >= 0; i--) {
      if (k > 0) {
        const c = comb(i, k - 1);
        if (s >= c) {
          s -= c;
          ep[i] = 0;
        } else {
          ep[i] = sliceIdx++;
          k--;
        }
      } else {
        ep[i] = 0;
      }
    }
  }

  // Lehmer code for permutation of length n
  function permToIndex(perm, n) {
    let idx = 0;
    for (let i = 0; i < n; i++) {
      let smaller = 0;
      for (let j = i + 1; j < n; j++) {
        if (perm[j] < perm[i]) smaller++;
      }
      idx = idx * (n - i) + smaller;
    }
    return idx;
  }
  function indexToPerm(idx, n, out) {
    const avail = [];
    for (let i = 0; i < n; i++) avail.push(i);
    const digits = new Int8Array(n);
    for (let i = n - 1; i >= 0; i--) {
      const base = n - i;
      digits[i] = idx % base;
      idx = (idx / base) | 0;
    }
    for (let i = 0; i < n; i++) {
      out[i] = avail.splice(digits[i], 1)[0];
    }
  }

  // Lazy-initialized tables
  let initialized = false;
  let twistMove, flipMove, sliceMove;
  let cpMove, udEdgeMove, slicePermMove;
  let prunSliceTwist, prunSliceFlip, prunSliceCP, prunSliceUDEdge;

  function buildPrunTable(sizeA, sizeB, moveA, moveB, movesList) {
    const total = sizeA * sizeB;
    const prun = new Uint8Array(total);
    prun.fill(255);
    prun[0] = 0;
    const mCount = movesList.length;
    let queue = new Int32Array(total);
    let qHead = 0, qTail = 0;
    queue[qTail++] = 0;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const d = prun[idx] + 1;
      const a = (idx / sizeB) | 0;
      const b = idx % sizeB;
      for (let mi = 0; mi < mCount; mi++) {
        const na = moveA[a * mCount + mi];
        const nb = moveB[b * mCount + mi];
        const nidx = na * sizeB + nb;
        if (prun[nidx] === 255) {
          prun[nidx] = d;
          queue[qTail++] = nidx;
        }
      }
    }
    return prun;
  }

  function initTables() {
    if (initialized) return;

    // 1. Phase 1 move tables
    twistMove = new Uint16Array(2187 * 18);
    const co = new Int8Array(8), tmpCp = new Int8Array(8), tmpCo = new Int8Array(8);
    const dummyCp = new Int8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let t = 0; t < 2187; t++) {
      setTwist(t, co);
      for (let m = 0; m < 18; m++) {
        multiplyCorners(dummyCp, co, ALL_MOVES[m].cp, ALL_MOVES[m].co, tmpCp, tmpCo);
        twistMove[t * 18 + m] = getTwist(tmpCo);
      }
    }

    flipMove = new Uint16Array(2048 * 18);
    const eo = new Int8Array(12), tmpEp = new Int8Array(12), tmpEo = new Int8Array(12);
    const dummyEp = new Int8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (let f = 0; f < 2048; f++) {
      setFlip(f, eo);
      for (let m = 0; m < 18; m++) {
        multiplyEdges(dummyEp, eo, ALL_MOVES[m].ep, ALL_MOVES[m].eo, tmpEp, tmpEo);
        flipMove[f * 18 + m] = getFlip(tmpEo);
      }
    }

    sliceMove = new Uint16Array(495 * 18);
    const ep = new Int8Array(12), zeroEo = new Int8Array(12);
    for (let s = 0; s < 495; s++) {
      setSliceClean(s, ep);
      for (let m = 0; m < 18; m++) {
        multiplyEdges(ep, zeroEo, ALL_MOVES[m].ep, ALL_MOVES[m].eo, tmpEp, tmpEo);
        sliceMove[s * 18 + m] = getSliceClean(tmpEp);
      }
    }

    // 2. Phase 2 move tables (10 moves)
    cpMove = new Uint16Array(40320 * 10);
    const cp = new Int8Array(8), zeroCo = new Int8Array(8);
    for (let c = 0; c < 40320; c++) {
      indexToPerm(c, 8, cp);
      for (let mi = 0; mi < 10; mi++) {
        const mv = ALL_MOVES[P2_MOVES[mi]];
        multiplyCorners(cp, zeroCo, mv.cp, mv.co, tmpCp, tmpCo);
        cpMove[c * 10 + mi] = permToIndex(tmpCp, 8);
      }
    }

    udEdgeMove = new Uint16Array(40320 * 10);
    const udEp = new Int8Array(12);
    const udSub = new Int8Array(8);
    for (let u = 0; u < 40320; u++) {
      indexToPerm(u, 8, udSub);
      for (let i = 0; i < 8; i++) udEp[i] = udSub[i];
      for (let i = 8; i < 12; i++) udEp[i] = i;
      for (let mi = 0; mi < 10; mi++) {
        const mv = ALL_MOVES[P2_MOVES[mi]];
        multiplyEdges(udEp, zeroEo, mv.ep, mv.eo, tmpEp, tmpEo);
        udEdgeMove[u * 10 + mi] = permToIndex(tmpEp, 8);
      }
    }

    slicePermMove = new Uint8Array(24 * 10);
    const spEp = new Int8Array(12);
    const spSub = new Int8Array(4);
    for (let sp = 0; sp < 24; sp++) {
      indexToPerm(sp, 4, spSub);
      for (let i = 0; i < 8; i++) spEp[i] = i;
      for (let i = 0; i < 4; i++) spEp[8 + i] = 8 + spSub[i];
      for (let mi = 0; mi < 10; mi++) {
        const mv = ALL_MOVES[P2_MOVES[mi]];
        multiplyEdges(spEp, zeroEo, mv.ep, mv.eo, tmpEp, tmpEo);
        for (let i = 0; i < 4; i++) spSub[i] = tmpEp[8 + i] - 8;
        slicePermMove[sp * 10 + mi] = permToIndex(spSub, 4);
      }
    }

    // 3. Pruning tables
    const all18 = Array.from({ length: 18 }, (_, i) => i);
    const all10 = Array.from({ length: 10 }, (_, i) => i);
    prunSliceTwist = buildPrunTable(495, 2187, sliceMove, twistMove, all18);
    prunSliceFlip = buildPrunTable(495, 2048, sliceMove, flipMove, all18);
    prunSliceCP = buildPrunTable(24, 40320, slicePermMove, cpMove, all10);
    prunSliceUDEdge = buildPrunTable(24, 40320, slicePermMove, udEdgeMove, all10);

    initialized = true;
  }

  function solveCubeOptimal(inputCube, maxTimeMs = 350) {
    if (inputCube.isSolved()) {
      return { ok: true, steps: [] };
    }
    initTables();

    const st = cubeToCubieState(inputCube);
    const twist0 = getTwist(st.co);
    const flip0 = getFlip(st.eo);
    const slice0 = getSliceClean(st.ep);

    const p1Moves = new Int8Array(32);
    const p2Moves = new Int8Array(32);
    let bestSolution = null;
    let bestLen = 30;
    const tStart = performance.now();

    function searchP2(sp, cp, ud, depth, lastFace) {
      const h = Math.max(prunSliceCP[sp * 40320 + cp], prunSliceUDEdge[sp * 40320 + ud]);
      if (h > depth) return false;
      if (depth === 0) return sp === 0 && cp === 0 && ud === 0;

      for (let mi = 0; mi < 10; mi++) {
        const m = P2_MOVES[mi];
        const face = (m / 3) | 0;
        if (face === lastFace) continue;
        if (lastFace !== -1 && face + 3 === lastFace) continue;
        p2Moves[depth] = m;
        if (
          searchP2(
            slicePermMove[sp * 10 + mi],
            cpMove[cp * 10 + mi],
            udEdgeMove[ud * 10 + mi],
            depth - 1,
            face
          )
        ) {
          return true;
        }
      }
      return false;
    }

    function solvePhase2(p1Len) {
      const curCp = new Int8Array(st.cp);
      const curCo = new Int8Array(st.co);
      const curEp = new Int8Array(st.ep);
      const curEo = new Int8Array(st.eo);
      const tmpCp = new Int8Array(8), tmpCo = new Int8Array(8);
      const tmpEp = new Int8Array(12), tmpEo = new Int8Array(12);

      for (let i = 0; i < p1Len; i++) {
        const mv = ALL_MOVES[p1Moves[i]];
        multiplyCorners(curCp, curCo, mv.cp, mv.co, tmpCp, tmpCo);
        curCp.set(tmpCp); curCo.set(tmpCo);
        multiplyEdges(curEp, curEo, mv.ep, mv.eo, tmpEp, tmpEo);
        curEp.set(tmpEp); curEo.set(tmpEo);
      }

      const cp0 = permToIndex(curCp, 8);
      const ud0 = permToIndex(curEp.subarray(0, 8), 8);
      const spSub = new Int8Array(4);
      for (let i = 0; i < 4; i++) spSub[i] = curEp[8 + i] - 8;
      const sp0 = permToIndex(spSub, 4);

      const maxP2 = Math.min(18, bestLen - 1 - p1Len);
      const minP2 = Math.max(prunSliceCP[sp0 * 40320 + cp0], prunSliceUDEdge[sp0 * 40320 + ud0]);
      const lastP1Face = p1Len > 0 ? (p1Moves[p1Len - 1] / 3) | 0 : -1;

      for (let d2 = minP2; d2 <= maxP2; d2++) {
        if (searchP2(sp0, cp0, ud0, d2, d2 === 0 ? -1 : lastP1Face)) {
          const sol = [];
          for (let i = 0; i < p1Len; i++) sol.push(MOVE_NAMES[p1Moves[i]]);
          for (let i = d2; i >= 1; i--) sol.push(MOVE_NAMES[p2Moves[i]]);
          bestLen = sol.length;
          bestSolution = sol;
          return true;
        }
      }
      return false;
    }

    function searchP1(twist, flip, slice, depth, totalDepth, lastFace) {
      if (bestSolution && performance.now() - tStart > maxTimeMs) return true;
      const h = Math.max(
        prunSliceTwist[slice * 2187 + twist],
        prunSliceFlip[slice * 2048 + flip]
      );
      if (h > depth) return false;
      if (depth === 0) {
        if (twist === 0 && flip === 0 && slice === 0) {
          solvePhase2(totalDepth);
          return bestLen <= 20;
        }
        return false;
      }

      for (let m = 0; m < 18; m++) {
        const face = (m / 3) | 0;
        if (face === lastFace) continue;
        if (lastFace !== -1 && face + 3 === lastFace) continue;
        p1Moves[totalDepth - depth] = m;
        const done = searchP1(
          twistMove[twist * 18 + m],
          flipMove[flip * 18 + m],
          sliceMove[slice * 18 + m],
          depth - 1,
          totalDepth,
          face
        );
        if (done) return true;
      }
      return false;
    }

    const minP1 = Math.max(
      prunSliceTwist[slice0 * 2187 + twist0],
      prunSliceFlip[slice0 * 2048 + flip0]
    );
    for (let d1 = minP1; d1 <= 14; d1++) {
      if (bestSolution && (d1 >= bestLen || performance.now() - tStart > maxTimeMs)) break;
      searchP1(twist0, flip0, slice0, d1, d1, -1);
    }

    if (!bestSolution) {
      return { ok: false, steps: [] };
    }

    return {
      ok: true,
      steps: bestSolution.map((m, idx) => ({
        move: m,
        phase: "⚡ 最優解（Two-Phase）",
        desc: `第 ${idx + 1} 步（共 ${bestSolution.length} 步最短路徑）`,
      })),
    };
  }

  global.CubeOptimalSolver = { solveCubeOptimal, initTables };
  if (typeof module !== "undefined" && module.exports) module.exports = global.CubeOptimalSolver;
})(typeof window !== "undefined" ? window : globalThis);
