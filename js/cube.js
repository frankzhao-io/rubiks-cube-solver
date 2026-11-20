// 3x3x3 Rubik's Cube State Model (26-Cubie 3D Coordinate Representation)
// Axes: +X=Right(R), -X=Left(L), +Y=Up(U), -Y=Down(D), +Z=Front(F), -Z=Back(B)

(function (global) {
  const FACES = ["U", "D", "F", "B", "R", "L"];
  const FACE_NORMALS = {
    U: [0, 1, 0],
    D: [0, -1, 0],
    F: [0, 0, 1],
    B: [0, 0, -1],
    R: [1, 0, 0],
    L: [-1, 0, 0],
  };

  const FACE_COLORS = {
    U: { name: "白", hex: "#f8fafc" },
    D: { name: "黃", hex: "#facc15" },
    F: { name: "綠", hex: "#22c55e" },
    B: { name: "藍", hex: "#3b82f6" },
    R: { name: "紅", hex: "#ef4444" },
    L: { name: "橘", hex: "#f97316" },
  };

  // Single 90-degree clockwise rotation rules around each face axis
  const MOVE_SPEC = {
    U: { axis: 1, layer: 1, rot: (x, y, z) => [-z, y, x] },
    D: { axis: 1, layer: -1, rot: (x, y, z) => [z, y, -x] },
    R: { axis: 0, layer: 1, rot: (x, y, z) => [x, z, -y] },
    L: { axis: 0, layer: -1, rot: (x, y, z) => [x, -z, y] },
    F: { axis: 2, layer: 1, rot: (x, y, z) => [y, -x, z] },
    B: { axis: 2, layer: -1, rot: (x, y, z) => [-y, x, z] },
    // Middle slice rotations (M follows L, E follows D, S follows F)
    M: { axis: 0, layer: 0, rot: (x, y, z) => [x, -z, y] },
    E: { axis: 1, layer: 0, rot: (x, y, z) => [z, y, -x] },
    S: { axis: 2, layer: 0, rot: (x, y, z) => [y, -x, z] },
    // Whole-cube rotation used internally if needed
    y: { axis: null, layer: null, rot: (x, y, z) => [-z, y, x] },
  };

  function rotateVec(v, rotFn, times) {
    let [x, y, z] = v;
    for (let i = 0; i < times; i++) {
      [x, y, z] = rotFn(x, y, z);
    }
    return [x, y, z];
  }

  class Cube {
    constructor() {
      this.reset();
    }

    reset() {
      this.cubies = [];
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            if (x === 0 && y === 0 && z === 0) continue;
            const stickers = [];
            if (y === 1) stickers.push({ n: [0, 1, 0], c: "U" });
            if (y === -1) stickers.push({ n: [0, -1, 0], c: "D" });
            if (z === 1) stickers.push({ n: [0, 0, 1], c: "F" });
            if (z === -1) stickers.push({ n: [0, 0, -1], c: "B" });
            if (x === 1) stickers.push({ n: [1, 0, 0], c: "R" });
            if (x === -1) stickers.push({ n: [-1, 0, 0], c: "L" });
            this.cubies.push({ pos: [x, y, z], stickers });
          }
        }
      }
    }

    clone() {
      const copy = new Cube();
      copy.cubies = this.cubies.map((cb) => ({
        pos: [...cb.pos],
        stickers: cb.stickers.map((s) => ({ n: [...s.n], c: s.c })),
      }));
      return copy;
    }

    applyMove(moveStr) {
      const base = moveStr[0];
      const mod = moveStr.slice(1);
      const spec = MOVE_SPEC[base];
      if (!spec) throw new Error(`Unknown move: ${moveStr}`);
      const times = mod === "2" ? 2 : mod === "'" ? 3 : 1;

      for (const cb of this.cubies) {
        if (spec.axis === null || cb.pos[spec.axis] === spec.layer) {
          cb.pos = rotateVec(cb.pos, spec.rot, times);
          for (const st of cb.stickers) {
            st.n = rotateVec(st.n, spec.rot, times);
          }
        }
      }
    }

    applyMoves(moves) {
      for (const m of moves) this.applyMove(m);
    }

    getCubieAt(x, y, z) {
      return this.cubies.find((c) => c.pos[0] === x && c.pos[1] === y && c.pos[2] === z);
    }

    getStickerColor(x, y, z, face) {
      const cb = this.getCubieAt(x, y, z);
      if (!cb) return null;
      const [nx, ny, nz] = FACE_NORMALS[face];
      const st = cb.stickers.find((s) => s.n[0] === nx && s.n[1] === ny && s.n[2] === nz);
      return st ? st.c : null;
    }

    setStickerColor(x, y, z, face, colorCode) {
      const cb = this.getCubieAt(x, y, z);
      if (!cb) return false;
      const [nx, ny, nz] = FACE_NORMALS[face];
      const st = cb.stickers.find((s) => s.n[0] === nx && s.n[1] === ny && s.n[2] === nz);
      if (!st) return false;
      st.c = colorCode;
      return true;
    }

    findCubieByColors(colors) {
      const sorted = [...colors].sort().join("");
      return this.cubies.find((cb) => {
        if (cb.stickers.length !== colors.length) return false;
        const cSorted = cb.stickers.map((s) => s.c).sort().join("");
        return cSorted === sorted;
      });
    }

    getColorFaceOnCubie(cubie, color) {
      const st = cubie.stickers.find((s) => s.c === color);
      if (!st) return null;
      for (const [f, n] of Object.entries(FACE_NORMALS)) {
        if (st.n[0] === n[0] && st.n[1] === n[1] && st.n[2] === n[2]) return f;
      }
      return null;
    }

    isSolved() {
      for (const face of FACES) {
        const [nx, ny, nz] = FACE_NORMALS[face];
        let expected = null;
        for (const cb of this.cubies) {
          for (const st of cb.stickers) {
            if (st.n[0] === nx && st.n[1] === ny && st.n[2] === nz) {
              if (expected === null) expected = st.c;
              else if (st.c !== expected) return false;
            }
          }
        }
      }
      return true;
    }

    static randomScramble(length = 20) {
      const axes = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };
      const mods = ["", "'", "2"];
      const seq = [];
      let prevFace = null;
      let prevAxis = null;
      while (seq.length < length) {
        const f = FACES[Math.floor(Math.random() * FACES.length)];
        if (f === prevFace) continue;
        if (axes[f] === prevAxis && seq.length >= 2 && axes[seq[seq.length - 2][0]] === prevAxis) continue;
        const m = mods[Math.floor(Math.random() * mods.length)];
        seq.push(f + m);
        prevFace = f;
        prevAxis = axes[f];
      }
      return seq;
    }

    validateSolvability() {
      // 1. Count stickers per color (must be 9 each)
      const counts = { U: 0, D: 0, F: 0, B: 0, R: 0, L: 0 };
      for (const cb of this.cubies) {
        for (const st of cb.stickers) counts[st.c] = (counts[st.c] || 0) + 1;
      }
      for (const f of FACES) {
        if (counts[f] !== 9) {
          return { ok: false, reason: `顏色數量錯誤：${FACE_COLORS[f].name}色目前有 ${counts[f]} 格（應為 9 格）。` };
        }
      }

      // 2. Check 6 centers are all distinct
      const centers = FACES.map((f) => {
        const [nx, ny, nz] = FACE_NORMALS[f];
        return this.getStickerColor(nx, ny, nz, f);
      });
      if (new Set(centers).size !== 6) {
        return { ok: false, reason: "六個面的中心塊必須是 6 種不同顏色。" };
      }

      // Map current center colors to canonical U/D/F/B/R/L
      const centerToFace = {};
      FACES.forEach((f, idx) => { centerToFace[centers[idx]] = f; });

      // 3. Verify all 12 edges and 8 corners exist uniquely & check twist/flip parity
      const solved = new Cube();
      let cornerTwistSum = 0;
      let edgeFlipSum = 0;
      const edgePerm = [];
      const cornerPerm = [];

      const canonicalEdges = solved.cubies.filter((c) => c.stickers.length === 2);
      const canonicalCorners = solved.cubies.filter((c) => c.stickers.length === 3);

      for (const slot of solved.cubies) {
        const cb = this.getCubieAt(slot.pos[0], slot.pos[1], slot.pos[2]);
        const mapped = cb.stickers.map((s) => centerToFace[s.c]);
        if (cb.stickers.length === 2) {
          const matchIdx = canonicalEdges.findIndex((ce) => {
            const target = ce.stickers.map((s) => s.c).sort().join("");
            return [...mapped].sort().join("") === target;
          });
          if (matchIdx === -1) return { ok: false, reason: "邊塊顏色組合無效（例如同一顆邊塊不可能同時出現對面色）。" };
          if (edgePerm.includes(matchIdx)) return { ok: false, reason: "偵測到重複的邊塊，請檢查填色。" };
          edgePerm.push(matchIdx);

          const stUorD = cb.stickers.find((s) => centerToFace[s.c] === "U" || centerToFace[s.c] === "D");
          const refSt = stUorD || cb.stickers.find((s) => centerToFace[s.c] === "F" || centerToFace[s.c] === "B");
          const onUD = Math.abs(refSt.n[1]) === 1;
          const onFB = Math.abs(refSt.n[2]) === 1;
          const isGood = onUD || (cb.pos[1] === 0 && onFB);
          if (!isGood) edgeFlipSum += 1;
        } else if (cb.stickers.length === 3) {
          const matchIdx = canonicalCorners.findIndex((cc) => {
            const target = cc.stickers.map((s) => s.c).sort().join("");
            return [...mapped].sort().join("") === target;
          });
          if (matchIdx === -1) return { ok: false, reason: "角塊顏色組合無效，請檢查角塊填色。" };
          if (cornerPerm.includes(matchIdx)) return { ok: false, reason: "偵測到重複的角塊，請檢查填色。" };
          cornerPerm.push(matchIdx);

          // Corner twist relative to U/D axis
          const udSticker = cb.stickers.find((s) => centerToFace[s.c] === "U" || centerToFace[s.c] === "D");
          if (Math.abs(udSticker.n[1]) !== 1) {
            // Determine clockwise vs counter-clockwise twist
            const [x, y, z] = cb.pos;
            const [nx, , nz] = udSticker.n;
            const cw = (x * y * z > 0) ? (nx !== 0 ? 1 : 2) : (nz !== 0 ? 1 : 2);
            cornerTwistSum += cw;
          }
        }
      }

      if (cornerTwistSum % 3 !== 0) {
        return { ok: false, reason: "角塊扭轉方向總和不合法（可能有單一角塊被手動掰轉過）。" };
      }
      if (edgeFlipSum % 2 !== 0) {
        return { ok: false, reason: "邊塊翻轉總數為奇數（可能有單一邊塊被拆開反裝）。" };
      }

      const countInversions = (arr) => {
        let inv = 0;
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) if (arr[i] > arr[j]) inv++;
        }
        return inv;
      };
      if ((countInversions(edgePerm) + countInversions(cornerPerm)) % 2 !== 0) {
        return { ok: false, reason: "角塊與邊塊排列奇偶性不匹配（可能有兩個塊被對調拆裝過）。" };
      }

      return { ok: true, reason: "狀態合法，可正常求解！" };
    }
  }

  global.CubeModel = { Cube, FACES, FACE_NORMALS, FACE_COLORS, MOVE_SPEC };
  if (typeof module !== "undefined" && module.exports) module.exports = global.CubeModel;
})(typeof window !== "undefined" ? window : globalThis);
