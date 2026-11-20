// HTML5 Canvas 3D Projection Renderer with Smooth Slice Animation & Sticker Picking
(function (global) {
  const { FACE_COLORS, MOVE_SPEC } = global.CubeModel;

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function rotX(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  }

  function rotY(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
  }

  function rotZ(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  }

  function pointInQuad(px, py, quad) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
      if (Math.abs(cross) < 1e-6) continue;
      const cur = cross > 0 ? 1 : -1;
      if (sign === 0) sign = cur;
      else if (sign !== cur) return false;
    }
    return true;
  }

  // Build 4 corner offsets for a sticker quad given normal vector n
  function stickerQuadCorners(pos, n, half = 0.48, inset = 0.40) {
    const [cx, cy, cz] = pos;
    const [nx, ny, nz] = n;
    const ox = cx + nx * half;
    const oy = cy + ny * half;
    const oz = cz + nz * half;

    let u, v;
    if (Math.abs(nx) === 1) { u = [0, 1, 0]; v = [0, 0, 1]; }
    else if (Math.abs(ny) === 1) { u = [1, 0, 0]; v = [0, 0, 1]; }
    else { u = [1, 0, 0]; v = [0, 1, 0]; }

    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return signs.map(([su, sv]) => [
      ox + (u[0] * su + v[0] * sv) * inset,
      oy + (u[1] * su + v[1] * sv) * inset,
      oz + (u[2] * su + v[2] * sv) * inset,
    ]);
  }

  function cubieBodyFaceCorners(pos, n, half = 0.48) {
    return stickerQuadCorners(pos, n, half, half);
  }

  // Exact visual rotation angle for each move matching CubeModel.MOVE_SPEC
  function getMoveRotation(moveStr) {
    const base = moveStr[0];
    const mod = moveStr.slice(1);
    const mult = mod === "2" ? 2 : mod === "'" ? -1 : 1;
    // Signs match right-handed axis rotation in MOVE_SPEC:
    // U: (-z, y, x) -> rotY(-PI/2)
    // D: (z, y, -x) -> rotY(+PI/2)
    // R: (x, z, -y) -> rotX(-PI/2)
    // L: (x, -z, y) -> rotX(+PI/2)
    // F: (y, -x, z) -> rotZ(-PI/2)
    // B: (-y, x, z) -> rotZ(+PI/2)
    const signMap = { U: -1, D: 1, R: -1, L: 1, F: -1, B: 1, M: 1, E: 1, S: -1 };
    const spec = MOVE_SPEC[base];
    return {
      axis: spec.axis,
      layer: spec.layer,
      angle: signMap[base] * (Math.PI / 2) * mult,
    };
  }

  class CubeRenderer3D {
    constructor(canvas, getCubeFn, onStickerClick, onLayerSwipe) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.getCube = getCubeFn;
      this.onStickerClick = onStickerClick;
      this.onLayerSwipe = onLayerSwipe || null;
      this.onDragPreview = null;
      this.swipeEnabled = true;

      this.yaw = -0.62;
      this.pitch = 0.48;
      this.anim = null;
      this.dragAnim = null;
      this.highlightLayer = null;
      this.hitPolys = [];
      this.dragMode = "smart"; // "smart" | "orbit"

      this._bindEvents();
      this.resize();
      window.addEventListener("resize", () => this.resize());
      this._loop();
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.max(280, Math.min(rect.width - 16, 480));
      this.canvas.width = size * dpr;
      this.canvas.height = size * dpr;
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
      this.size = size;
      this.dpr = dpr;
    }

    _hitTest(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      for (let i = this.hitPolys.length - 1; i >= 0; i--) {
        const hp = this.hitPolys[i];
        if (pointInQuad(cx, cy, hp.quad)) return hp;
      }
      return null;
    }

    _resolveSwipeMove(pos, n, dx, dy) {
      let u, v;
      if (Math.abs(n[0]) === 1) { u = [0, 1, 0]; v = [0, 0, 1]; }
      else if (Math.abs(n[1]) === 1) { u = [1, 0, 0]; v = [0, 0, 1]; }
      else { u = [1, 0, 0]; v = [0, 1, 0]; }

      const candidates = [u, [-u[0], -u[1], -u[2]], v, [-v[0], -v[1], -v[2]]];
      const p0 = this._project(pos);
      let bestDir = null;
      let bestDot = -Infinity;
      for (const d of candidates) {
        const p1 = this._project([pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]);
        const vx = p1[0] - p0[0];
        const vy = p1[1] - p0[1];
        const len = Math.hypot(vx, vy) || 1;
        const dot = (dx * vx + dy * vy) / len;
        if (dot > bestDot) {
          bestDot = dot;
          bestDir = d;
        }
      }
      if (!bestDir) return null;

      const rotAxis = [
        n[1] * bestDir[2] - n[2] * bestDir[1],
        n[2] * bestDir[0] - n[0] * bestDir[2],
        n[0] * bestDir[1] - n[1] * bestDir[0],
      ];
      const axis = rotAxis[0] !== 0 ? 0 : rotAxis[1] !== 0 ? 1 : 2;
      const rotSign = rotAxis[axis];
      const layer = pos[axis];

      const baseMap = {
        "1,1": ["U", -1],
        "1,0": ["E", 1],
        "1,-1": ["D", 1],
        "0,1": ["R", -1],
        "0,0": ["M", 1],
        "0,-1": ["L", 1],
        "2,1": ["F", -1],
        "2,0": ["S", -1],
        "2,-1": ["B", 1],
      };
      const entry = baseMap[`${axis},${layer}`];
      if (!entry) return null;
      const [base, posSign] = entry;
      const move = rotSign === posSign ? base : `${base}'`;

      // Compute normalized 2D screen direction for live drag tracking
      const p1 = this._project([pos[0] + bestDir[0], pos[1] + bestDir[1], pos[2] + bestDir[2]]);
      const sx = p1[0] - p0[0];
      const sy = p1[1] - p0[1];
      const slen = Math.hypot(sx, sy) || 1;

      return {
        move,
        invMove: rotSign === posSign ? `${base}'` : base,
        axis,
        layer,
        rotSign,
        ux: sx / slen,
        uy: sy / slen,
      };
    }

    _bindEvents() {
      let dragging = false;
      let moved = false;
      let forceOrbit = false;
      let lx = 0, ly = 0;
      let swipeCandidate = null;
      let activeDragTurn = null;

      this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

      const start = (x, y, opts = {}) => {
        dragging = true;
        moved = false;
        lx = x;
        ly = y;
        activeDragTurn = null;
        this.dragAnim = null;

        const wantTurn =
          this.onLayerSwipe &&
          this.swipeEnabled &&
          !this.anim &&
          (opts.forceTurn || (this.dragMode === "smart" && !opts.forceOrbit));

        if (wantTurn) {
          const hit = this._hitTest(x, y);
          swipeCandidate = hit ? { pos: hit.pos, normal: hit.normal, startX: x, startY: y } : null;
          forceOrbit = !hit;
        } else {
          swipeCandidate = null;
          forceOrbit = true;
        }
      };

      const move = (x, y) => {
        if (!dragging) {
          if (this.dragMode === "smart" && this.swipeEnabled && !this.anim) {
            this.canvas.style.cursor = this._hitTest(x, y) ? "pointer" : "grab";
          } else {
            this.canvas.style.cursor = "grab";
          }
          return;
        }

        if (activeDragTurn) {
          const dx = x - activeDragTurn.startX;
          const dy = y - activeDragTurn.startY;
          const proj = dx * activeDragTurn.ux + dy * activeDragTurn.uy;
          const frac = Math.max(-1.08, Math.min(1.08, proj / (this.size * 0.22)));
          const angle = frac * (Math.PI / 2) * activeDragTurn.rotSign;
          this.dragAnim = {
            axis: activeDragTurn.axis,
            layer: activeDragTurn.layer,
            angle,
          };
          if (this.onDragPreview) {
            if (Math.abs(angle) >= 0.08) {
              const sameSign = Math.sign(angle) === Math.sign(activeDragTurn.rotSign);
              const chosen = sameSign ? activeDragTurn.move : activeDragTurn.invMove;
              this.onDragPreview(chosen, Math.abs(angle) >= 0.34);
            } else {
              this.onDragPreview(null, false);
            }
          }
          return;
        }

        if (swipeCandidate && !forceOrbit && !this.anim) {
          const sdx = x - swipeCandidate.startX;
          const sdy = y - swipeCandidate.startY;
          if (Math.hypot(sdx, sdy) >= 7) {
            const info = this._resolveSwipeMove(swipeCandidate.pos, swipeCandidate.normal, sdx, sdy);
            if (info) {
              activeDragTurn = {
                ...info,
                startX: swipeCandidate.startX,
                startY: swipeCandidate.startY,
              };
              swipeCandidate = null;
              moved = true;
              return;
            } else {
              // Middle slice or invalid: seamlessly fall back to camera orbit
              swipeCandidate = null;
              forceOrbit = true;
            }
          } else {
            return;
          }
        }

        const dx = x - lx, dy = y - ly;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        this.yaw += dx * 0.01;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.01));
        lx = x; ly = y;
      };

      const end = (x, y) => {
        if (this.onDragPreview) this.onDragPreview(null, false);
        if (activeDragTurn && this.dragAnim) {
          const curAngle = this.dragAnim.angle;
          const threshold = 0.34; // ~19.5 deg
          if (Math.abs(curAngle) >= threshold) {
            const sameSign = Math.sign(curAngle) === Math.sign(activeDragTurn.rotSign);
            const chosenMove = sameSign ? activeDragTurn.move : activeDragTurn.invMove;
            const targetAngle = Math.sign(curAngle) * (Math.PI / 2);
            const remainingFrac = Math.max(0.15, Math.abs(targetAngle - curAngle) / (Math.PI / 2));
            this.dragAnim = null;
            this.anim = {
              axis: activeDragTurn.axis,
              layer: activeDragTurn.layer,
              fromAngle: curAngle,
              angle: targetAngle,
              start: performance.now(),
              duration: Math.round(140 * remainingFrac),
              onComplete: () => this.onLayerSwipe(chosenMove),
            };
          } else {
            this.dragAnim = null;
          }
          activeDragTurn = null;
          swipeCandidate = null;
          dragging = false;
          return;
        }

        swipeCandidate = null;
        if (dragging && !moved && this.onStickerClick && !this.anim) {
          const hp = this._hitTest(x, y);
          if (hp) this.onStickerClick(hp.pos, hp.normal);
        }
        dragging = false;
      };

      this.canvas.addEventListener("mousedown", (e) => {
        const isRight = e.button === 2;
        start(e.clientX, e.clientY, {
          forceOrbit: isRight,
          forceTurn: !isRight && e.shiftKey,
        });
      });
      window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
      window.addEventListener("mouseup", (e) => end(e.clientX, e.clientY));

      this.canvas.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        start(t.clientX, t.clientY, { forceOrbit: e.touches.length >= 2 });
      }, { passive: true });
      window.addEventListener("touchmove", (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        move(t.clientX, t.clientY);
      }, { passive: true });
      window.addEventListener("touchend", (e) => {
        const t = e.changedTouches[0];
        end(t.clientX, t.clientY);
      });
    }

    animateMove(moveStr, durationMs, onComplete) {
      const rot = getMoveRotation(moveStr);
      this.anim = {
        ...rot,
        fromAngle: 0,
        start: performance.now(),
        duration: durationMs,
        onComplete,
      };
    }

    _project(p) {
      let v = rotY(p, this.yaw);
      v = rotX(v, this.pitch);
      const dist = 6.2;
      const scale = (this.size * 0.68) / (dist - v[2]);
      return [
        this.size / 2 + v[0] * scale,
        this.size / 2 - v[1] * scale,
        v[2],
      ];
    }

    _applySliceAnim(p, cubiePos) {
      let ang = 0;
      let axis = -1;
      if (this.dragAnim && cubiePos[this.dragAnim.axis] === this.dragAnim.layer) {
        axis = this.dragAnim.axis;
        ang = this.dragAnim.angle;
      } else if (this.anim && cubiePos[this.anim.axis] === this.anim.layer) {
        axis = this.anim.axis;
        const elapsed = performance.now() - this.anim.start;
        const t = Math.min(1, elapsed / this.anim.duration);
        const from = this.anim.fromAngle || 0;
        ang = from + (this.anim.angle - from) * easeInOut(t);
      } else {
        return p;
      }
      if (axis === 0) return rotX(p, ang);
      if (axis === 1) return rotY(p, ang);
      return rotZ(p, ang);
    }

    _drawFrame() {
      const ctx = this.ctx;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, this.size, this.size);

      const cube = this.getCube();
      const polys = [];
      const ALL_NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

      for (const cb of cube.cubies) {
        // Dark plastic cubie faces
        for (const n of ALL_NORMALS) {
          const corners = cubieBodyFaceCorners(cb.pos, n).map((pt) =>
            this._project(this._applySliceAnim(pt, cb.pos))
          );
          const avgZ = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4;
          polys.push({ corners, avgZ, fill: "#111827", stroke: "#020617", isSticker: false });
        }

        // Colored stickers
        const isHighlighted =
          !this.anim &&
          this.highlightLayer &&
          cb.pos[this.highlightLayer.axis] === this.highlightLayer.layer;

        for (const st of cb.stickers) {
          const corners = stickerQuadCorners(cb.pos, st.n).map((pt) =>
            this._project(this._applySliceAnim(pt, cb.pos))
          );
          const avgZ = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4 + 0.01;
          polys.push({
            corners,
            avgZ,
            fill: FACE_COLORS[st.c].hex,
            stroke: isHighlighted ? "#38bdf8" : "#0f172a",
            strokeWidth: isHighlighted ? 2.4 : 1.2,
            isSticker: true,
            pos: cb.pos,
            normal: st.n,
          });
        }
      }

      polys.sort((a, b) => a.avgZ - b.avgZ);

      const newHits = [];
      for (const poly of polys) {
        ctx.beginPath();
        ctx.moveTo(poly.corners[0][0], poly.corners[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(poly.corners[i][0], poly.corners[i][1]);
        ctx.closePath();
        ctx.fillStyle = poly.fill;
        ctx.fill();
        ctx.strokeStyle = poly.stroke;
        ctx.lineWidth = poly.strokeWidth || (poly.isSticker ? 1.2 : 0.8);
        ctx.stroke();

        if (poly.isSticker) {
          newHits.push({
            quad: poly.corners.map((c) => [c[0], c[1]]),
            pos: poly.pos,
            normal: poly.normal,
          });
        }
      }
      this.hitPolys = newHits;
      ctx.restore();

      if (this.anim) {
        const done = performance.now() - this.anim.start >= this.anim.duration;
        if (done) {
          const cb = this.anim.onComplete;
          this.anim = null;
          if (cb) cb();
        }
      }
    }

    _loop() {
      this._drawFrame();
      requestAnimationFrame(() => this._loop());
    }
  }

  global.CubeRenderer3D = CubeRenderer3D;
})(window);
