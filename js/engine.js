/* ==========================================================
   造景 · Canvas 渲染引擎
   ----------------------------------------------------------
   设计要点
   · 全部用 Canvas 2D 绘制，所有尺寸都相对画布换算，
     所以同一组参数在 480px 预览和 4K 导出里构图完全一致。
   · 随机数带种子（xorshift32）：种子相同 → 画面永远相同。
   · 柔和过渡一律用渐变实现，不依赖 ctx.filter / SVG 滤镜，
     导出时不会丢效果。
   ========================================================== */
(function () {
  'use strict';

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- 随机 & 噪声 ---------------- */
  function rng(seed) {
    let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  const R = (r, a, b) => a + r() * (b - a);
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

  const fade = (t) => t * t * (3 - 2 * t);

  // 一维值噪声（可叠加八度）
  function noise1(r) {
    const N = 512, tab = new Float64Array(N);
    for (let i = 0; i < N; i++) tab[i] = r();
    const at = (i) => tab[((i % N) + N) % N];
    return function (x, oct = 3, gain = 0.5, lac = 2) {
      let sum = 0, amp = 1, norm = 0, f = 1;
      for (let o = 0; o < oct; o++) {
        const xx = x * f, i = Math.floor(xx), t = fade(xx - i);
        sum += lerp(at(i), at(i + 1), t) * amp;
        norm += amp; amp *= gain; f *= lac;
      }
      return sum / norm;
    };
  }

  // 二维值噪声
  function noise2(r) {
    const N = 256, tab = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) tab[i] = r();
    const at = (i, j) => tab[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    return function (x, y, oct = 4, gain = 0.5, lac = 2) {
      let sum = 0, amp = 1, norm = 0, f = 1;
      for (let o = 0; o < oct; o++) {
        const xx = x * f, yy = y * f;
        const i = Math.floor(xx), j = Math.floor(yy);
        const tx = fade(xx - i), ty = fade(yy - j);
        const v = lerp(lerp(at(i, j), at(i + 1, j), tx), lerp(at(i, j + 1), at(i + 1, j + 1), tx), ty);
        sum += v * amp; norm += amp; amp *= gain; f *= lac;
      }
      return sum / norm;
    };
  }

  /* ---------------- 颜色 ---------------- */
  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // 在一组颜色上按 0..1 取色
  function sampler(list) {
    const cs = list.map(hex2rgb);
    return function (t) {
      t = clamp(t, 0, 1) * (cs.length - 1);
      const i = Math.min(cs.length - 2, Math.floor(t));
      return mix(cs[i], cs[i + 1], t - i);
    };
  }

  /* ---------------- 通用绘制 ---------------- */
  function skyGradient(S, a, b, from = 0, to = 1) {
    const { ctx, W, H } = S;
    const g = ctx.createLinearGradient(0, H * from, 0, H * to);
    g.addColorStop(0, css(a));
    g.addColorStop(1, css(b));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 柔光团（取代高斯模糊）
  function blob(S, x, y, r, color, alpha, stops) {
    const { ctx } = S;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    (stops || [[0, 1], [0.45, 0.5], [1, 0]]).forEach(([p, a]) => g.addColorStop(p, rgba(color, a * alpha)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // 雾带：山脚渐隐
  function mistBand(S, y, h, color, alpha) {
    const { ctx, W } = S;
    const g = ctx.createLinearGradient(0, y - h, 0, y + h);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.5, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y - h, W, h * 2);
  }

  // 笔触：沿折线两侧按粗细外扩
  function taper(S, pts, width, prof) {
    const { ctx } = S, n = pts.length, left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, hw = (width * prof(i / (n - 1))) / 2;
      left.push([pts[i][0] + nx * hw, pts[i][1] + ny * hw]);
      right.push([pts[i][0] - nx * hw, pts[i][1] - ny * hw]);
    }
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  const P_LEAF = (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.75)), 0.9);
  const P_TAPER = (t) => 1 - t * 0.85;

  function bezPts(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return out;
  }

  /* ---------------- 点景 ---------------- */
  function birds(S, x, y, n, color, scale, alpha) {
    const { ctx, r } = S;
    ctx.save();
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const k = scale * R(r, 0.7, 1.2);
      const bx = x + R(r, 0, scale * 9), by = y + R(r, 0, scale * 5);
      ctx.lineWidth = Math.max(1, k * 0.22);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + k * 0.5, by - k * 0.5, bx + k, by);
      ctx.quadraticCurveTo(bx + k * 1.5, by - k * 0.5, bx + k * 2, by);
      ctx.stroke();
    }
    ctx.restore();
  }

  function pine(S, x, y, h, color, alpha) {
    const { ctx } = S;
    ctx.save();
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.rect(x - h * 0.035, y - h * 0.45, h * 0.07, h * 0.45);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const yy = y - h * (0.42 + i * 0.16), w = h * (0.3 - i * 0.055);
      ctx.beginPath();
      ctx.moveTo(x - w, yy);
      ctx.quadraticCurveTo(x, yy - h * 0.1, x + w, yy);
      ctx.quadraticCurveTo(x, yy - h * 0.03, x - w, yy);
      ctx.fill();
    }
    ctx.restore();
  }

  function sunDisc(S, x, y, r, color, glow, alpha) {
    blob(S, x, y, r * 4.2, glow, alpha * 0.5, [[0, 0.55], [0.3, 0.22], [1, 0]]);
    S.ctx.fillStyle = rgba(color, alpha);
    S.ctx.beginPath();
    S.ctx.arc(x, y, r, 0, TAU);
    S.ctx.fill();
  }

  /* ---------------- 山脊 ---------------- */
  // 返回 x(像素) → y(像素) 的山脊函数
  function ridgeFn(S, base, amp, freq, sharp, oct) {
    const nz = noise1(S.r), ph = S.r() * 100;
    return (x) => {
      const t = x / S.W;
      let v = nz(t * freq + ph, oct);
      v = Math.pow(clamp(v, 0, 1), sharp);
      return base - v * amp;
    };
  }

  function fillRidge(S, fn, color, alpha, lineAlpha) {
    const { ctx, W, H } = S;
    const step = Math.max(2, W / 420);
    ctx.beginPath();
    ctx.moveTo(0, fn(0));
    for (let x = step; x <= W; x += step) ctx.lineTo(x, fn(x));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill();
    if (lineAlpha > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, fn(0));
      for (let x = step; x <= W; x += step) ctx.lineTo(x, fn(x));
      ctx.strokeStyle = rgba(color, Math.min(1, alpha + lineAlpha));
      ctx.lineWidth = Math.max(1, S.U * 0.0022);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------------- 风格 ---------------- */
  const PAINTERS = {
    /* 远山 · 层叠水墨 */
    shan(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      const bg0 = hex2rgb(pal.bg[0]), bg1 = hex2rgb(pal.bg[1]);
      skyGradient(S, bg0, bg1);
      const hz = prm.horizon;
      if (prm.sun) {
        const sr = U * 0.075;
        sunDisc(S, W * prm.sunX, H * hz * 0.52, sr, hex2rgb(pal.accent), hex2rgb(pal.glow), pal.dark ? 0.95 : 0.85);
      }
      if (prm.birds) birds(S, W * (prm.sunX > 0.5 ? 0.12 : 0.6), H * hz * 0.38, 4, lay(0.9), U * 0.03, 0.5);

      const n = prm.layers;
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 1;
        const base = lerp(H * hz, H * 1.04, Math.pow(t, 0.92));
        const amp = U * lerp(0.3, 0.13, t) * (0.35 + prm.relief * 0.9);
        const fn = ridgeFn(S, base, amp, lerp(2.2, 4.6, t) + r() * 0.8, lerp(1.5, 1.05, t), 3);
        fillRidge(S, fn, lay(t), lerp(0.55, 1, t), pal.dark ? 0.04 : 0.1);
        if (prm.mist > 0.02 && i < n - 1) mistBand(S, base, U * 0.075 * (0.4 + prm.mist), bg1, 0.55 * prm.mist + 0.2);
        // 近景松树
        if (i === n - 1 && prm.detail > 0.3) {
          const cnt = Math.round(prm.detail * 9);
          for (let k = 0; k < cnt; k++) {
            const x = R(r, 0, W), y = fn(x) + U * 0.004;
            if (y < H * 0.99) pine(S, x, y, U * R(r, 0.05, 0.1) * (0.5 + prm.detail), lay(1), 0.95);
          }
        }
      }
    },

    /* 落日 */
    luori(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      const bg0 = hex2rgb(pal.bg[0]), bg1 = hex2rgb(pal.bg[1]), glow = hex2rgb(pal.glow);
      skyGradient(S, bg0, bg1);
      const hz = prm.horizon, sy = H * hz * 0.72, sx = W * prm.sunX;
      blob(S, sx, sy, U * 0.9, glow, 0.5, [[0, 0.5], [0.4, 0.2], [1, 0]]);
      if (prm.sun) sunDisc(S, sx, sy, U * 0.11, hex2rgb(pal.accent), glow, 0.95);
      if (prm.birds) birds(S, W * 0.1, H * hz * 0.3, 3, lay(0.85), U * 0.032, 0.45);

      const n = prm.layers;
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 1;
        const base = lerp(H * hz, H * 1.05, Math.pow(t, 0.95));
        const amp = U * lerp(0.17, 0.08, t) * (0.3 + prm.relief);
        const fn = ridgeFn(S, base, amp, lerp(1.4, 3, t) + r() * 0.5, 1.05, 2);
        fillRidge(S, fn, lay(t), 1, 0);
        if (prm.mist > 0.02 && i < n - 1) mistBand(S, base, U * 0.06 * (0.4 + prm.mist), bg1, 0.5 * prm.mist);
      }
      // 水面与倒影
      if (hz < 0.72) {
        const wy = H * hz;
        const g = ctx.createLinearGradient(0, wy, 0, H);
        g.addColorStop(0, rgba(mix(bg1, lay(0.6), 0.45), 0.95));
        g.addColorStop(1, rgba(lay(0.85), 0.95));
        ctx.fillStyle = g;
        ctx.fillRect(0, wy, W, H - wy);
        // 倒影光柱
        const col = ctx.createLinearGradient(0, wy, 0, H);
        col.addColorStop(0, rgba(glow, 0.3));
        col.addColorStop(1, rgba(glow, 0));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sx - U * 0.1, wy);
        ctx.lineTo(sx + U * 0.1, wy);
        ctx.lineTo(sx + U * 0.26, H);
        ctx.lineTo(sx - U * 0.26, H);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.restore();
        // 碎波：越远越细越密
        const cnt = Math.round(26 + prm.detail * 34);
        for (let i = 0; i < cnt; i++) {
          const k = Math.pow(r(), 0.65);
          const y = wy + k * (H - wy);
          const half = U * lerp(0.03, 0.2, k) * R(r, 0.5, 1.3);
          const cx2 = sx + U * R(r, -0.09, 0.09) * (0.3 + k);
          const th = Math.max(1, U * lerp(0.0025, 0.006, k));
          const lg = ctx.createLinearGradient(cx2 - half, y, cx2 + half, y);
          lg.addColorStop(0, rgba(glow, 0));
          lg.addColorStop(0.5, rgba(glow, R(r, 0.2, 0.55) * (1 - k * 0.45)));
          lg.addColorStop(1, rgba(glow, 0));
          ctx.fillStyle = lg;
          ctx.fillRect(cx2 - half, y, half * 2, th);
        }
      }
    },

    /* 海浪 */
    haiwave(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      const hz = prm.horizon;
      if (prm.sun) sunDisc(S, W * prm.sunX, H * hz * 0.55, U * 0.07, hex2rgb(pal.accent), hex2rgb(pal.glow), 0.9);
      if (prm.birds) birds(S, W * 0.12, H * hz * 0.4, 3, lay(0.9), U * 0.03, 0.45);
      const n = Math.max(4, Math.round(prm.layers * 1.8));
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const base = lerp(H * hz, H * 1.03, t);
        const amp = U * (0.012 + 0.05 * prm.relief) * (0.5 + t);
        const freq = R(r, 1.2, 2.8), ph = r() * TAU;
        const step = Math.max(2, W / 300);
        ctx.beginPath();
        ctx.moveTo(0, base + Math.sin(ph) * amp);
        for (let x = step; x <= W; x += step) ctx.lineTo(x, base + Math.sin((x / W) * freq * TAU + ph) * amp);
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        ctx.fillStyle = rgba(lay(t), 1);
        ctx.fill();
        if (i < 3 || prm.detail > 0.5) {
          ctx.beginPath();
          ctx.moveTo(0, base + Math.sin(ph) * amp);
          for (let x = step; x <= W; x += step) ctx.lineTo(x, base + Math.sin((x / W) * freq * TAU + ph) * amp);
          ctx.strokeStyle = rgba(hex2rgb(pal.bg[0]), 0.3 * (1 - t) + 0.12);
          ctx.lineWidth = Math.max(1, U * 0.002);
          ctx.stroke();
        }
      }
    },

    /* 云海 */
    yunhai(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      const hz = prm.horizon;
      if (prm.sun) sunDisc(S, W * prm.sunX, H * hz * 0.5, U * 0.085, hex2rgb(pal.accent), hex2rgb(pal.glow), 0.9);
      // 远峰只露尖
      const peaks = Math.round(2 + prm.layers * 0.8);
      for (let i = 0; i < peaks; i++) {
        const t = i / Math.max(1, peaks - 1);
        const cx = R(r, -0.1, 1.1) * W, base = lerp(H * (hz + 0.08), H * 0.95, t);
        const hh = U * R(r, 0.12, 0.3) * (0.4 + prm.relief), hw = hh * R(r, 0.9, 1.7);
        ctx.fillStyle = rgba(lay(1 - t * 0.8), 0.9);
        ctx.beginPath();
        ctx.moveTo(cx - hw, base);
        ctx.quadraticCurveTo(cx - hw * 0.25, base - hh * 1.06, cx, base - hh);
        ctx.quadraticCurveTo(cx + hw * 0.3, base - hh * 0.95, cx + hw, base);
        ctx.closePath();
        ctx.fill();
      }
      // 层层云带
      const bands = Math.round(5 + prm.mist * 7);
      const cloud = mix(hex2rgb(pal.bg[0]), [255, 255, 255], pal.dark ? 0.08 : 0.45);
      for (let i = 0; i < bands; i++) {
        const y = lerp(H * hz, H * 1.0, i / bands) + U * R(r, -0.02, 0.02);
        const n = 4 + Math.round(r() * 4);
        for (let k = 0; k < n; k++) {
          blob(S, R(r, -0.1, 1.1) * W, y, U * R(r, 0.18, 0.45), cloud, R(r, 0.1, 0.3) * (0.5 + prm.mist), [[0, 0.55], [0.5, 0.2], [1, 0]]);
        }
      }
      if (prm.birds) birds(S, W * 0.15, H * hz * 0.4, 3, lay(0.9), U * 0.028, 0.4);
    },

    /* 星夜 */
    xingye(S) {
      const { ctx, W, H, U, L, r, pal, prm, lay } = S;
      // 星空必须是暗的：浅色配色时改用这套配色里最深的两档当夜空
      const dark = pal.dark;
      const sky0 = dark ? hex2rgb(pal.bg[0]) : mix(hex2rgb(pal.layers[4]), [0, 0, 0], 0.45);
      const sky1 = dark ? hex2rgb(pal.bg[1]) : hex2rgb(pal.layers[4]);
      skyGradient(S, sky0, sky1);
      const hz = prm.horizon;
      const star = dark ? mix(hex2rgb(pal.glow), [255, 255, 255], 0.5) : mix(hex2rgb(pal.bg[0]), [255, 255, 255], 0.3);
      // 银河
      const ga = R(r, -0.5, 0.5), gx = W * R(r, 0.3, 0.7), gy = H * hz * 0.5;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(ga);
      for (let i = 0; i < 7; i++) blob(S, R(r, -0.4, 0.4) * L, R(r, -0.06, 0.06) * L, L * R(r, 0.1, 0.22), star, 0.07 * (0.4 + prm.mist));
      ctx.restore();
      // 星
      const cnt = Math.round(140 + prm.detail * 460);
      for (let i = 0; i < cnt; i++) {
        const x = r() * W, y = Math.pow(r(), 1.25) * H * hz;
        const rad = Math.pow(r(), 2.4) * U * 0.004 + U * 0.0007;
        ctx.fillStyle = rgba(star, R(r, 0.25, 1));
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
      }
      for (let i = 0; i < 7; i++) blob(S, r() * W, r() * H * hz * 0.9, U * R(r, 0.02, 0.05), star, 0.5);
      // 月（在离屏画布上挖出月牙，避免在背景上打洞）
      if (prm.sun) {
        const mx = W * prm.sunX, my = H * hz * 0.4, mr = U * 0.075;
        blob(S, mx, my, mr * 5, hex2rgb(pal.glow), 0.4, [[0, 0.5], [0.35, 0.16], [1, 0]]);
        const pad = mr * 2.4, off = document.createElement('canvas');
        off.width = off.height = Math.max(8, Math.ceil(pad * 2));
        const oc = off.getContext('2d');
        oc.fillStyle = rgba(mix(hex2rgb(pal.accent), [255, 255, 255], 0.25), 0.97);
        oc.beginPath();
        oc.arc(pad, pad, mr, 0, TAU);
        oc.fill();
        oc.globalCompositeOperation = 'destination-out';
        oc.beginPath();
        oc.arc(pad + mr * 0.42, pad - mr * 0.3, mr * 0.9, 0, TAU);
        oc.fill();
        ctx.drawImage(off, mx - pad, my - pad);
      }
      // 剪影山
      const n = Math.max(2, prm.layers - 1);
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 1;
        const base = lerp(H * (hz + 0.06), H * 1.04, t);
        const amp = U * lerp(0.26, 0.12, t) * (0.35 + prm.relief * 0.9);
        const fn = ridgeFn(S, base, amp, lerp(2.4, 4.4, t), lerp(1.45, 1.05, t), 3);
        fillRidge(S, fn, mix(sky1, [0, 0, 0], lerp(0.35, 0.8, t)), 1, 0);
      }
    },

    /* 等高线 */
    dengaoxian(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      const nz = noise2(r);
      // 噪声在两个方向上频率一致，画面不会被拉长
      const gx = 150, gy = Math.max(40, Math.round((gx * H) / W));
      const fscale = lerp(1.4, 4.2, prm.relief);
      const ar = H / W;
      const warp = prm.detail * 0.9;
      const grid = new Float64Array((gx + 1) * (gy + 1));
      for (let j = 0; j <= gy; j++) {
        for (let i = 0; i <= gx; i++) {
          const u = i / gx, v = (j / gy) * ar;
          let val = nz(u * fscale, v * fscale, 4);
          val = val * 0.75 + nz(u * fscale * 2.6 + 7, v * fscale * 2.6 + 3, 2) * 0.25 * (0.3 + warp);
          grid[j * (gx + 1) + i] = val;
        }
      }
      const levels = Math.round(10 + prm.layers * 6);
      const cw = W / gx, ch = H / gy;
      const ip = (a, b, lv) => clamp((lv - a) / (b - a || 1e-6), 0, 1);
      for (let L = 1; L < levels; L++) {
        const lv = L / levels;
        const t = L / levels;
        ctx.beginPath();
        for (let j = 0; j < gy; j++) {
          for (let i = 0; i < gx; i++) {
            const a = grid[j * (gx + 1) + i], b = grid[j * (gx + 1) + i + 1];
            const c = grid[(j + 1) * (gx + 1) + i + 1], d = grid[(j + 1) * (gx + 1) + i];
            const code = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
            if (code === 0 || code === 15) continue;
            const x0 = i * cw, y0 = j * ch;
            const top = [x0 + ip(a, b, lv) * cw, y0];
            const right = [x0 + cw, y0 + ip(b, c, lv) * ch];
            const bottom = [x0 + ip(d, c, lv) * cw, y0 + ch];
            const left = [x0, y0 + ip(a, d, lv) * ch];
            const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
            switch (code) {
              case 1: case 14: seg(left, bottom); break;
              case 2: case 13: seg(bottom, right); break;
              case 3: case 12: seg(left, right); break;
              case 4: case 11: seg(top, right); break;
              case 6: case 9: seg(top, bottom); break;
              case 7: case 8: seg(left, top); break;
              case 5: seg(left, top); seg(bottom, right); break;
              case 10: seg(left, bottom); seg(top, right); break;
            }
          }
        }
        const major = L % 5 === 0;
        ctx.strokeStyle = rgba(lay(t), major ? 0.95 : 0.6);
        ctx.lineWidth = Math.max(1, U * (major ? 0.0032 : 0.0015));
        ctx.stroke();
      }
    },

    /* 年轮 */
    nianlun(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      const cx = W * lerp(0.3, 0.7, prm.sunX), cy = H * lerp(0.3, 0.7, prm.horizon);
      const maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.02;
      const rings = Math.round(26 + prm.layers * 9);
      const nz = noise1(r), ph = r() * TAU;
      const wob = 0.02 + prm.relief * 0.16;
      for (let k = 1; k <= rings; k++) {
        const t = k / rings, rad = maxR * t;
        const seg = Math.max(60, Math.round(rad / (U * 0.012)));
        ctx.beginPath();
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * TAU;
          const d = rad * (1 + Math.sin(a * 3 + ph + t * 4) * wob * 0.5 + (nz(a * 1.4 + t * 9, 2) - 0.5) * wob);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        const major = k % 5 === 0;
        ctx.strokeStyle = rgba(lay(t), major ? 0.9 : R(r, 0.35, 0.7));
        ctx.lineWidth = Math.max(1, U * (major ? 0.0034 : 0.0016));
        ctx.stroke();
      }
      if (prm.detail > 0.35) {
        ctx.beginPath();
        let x = cx, y = cy;
        ctx.moveTo(x, y);
        const dir = r() * TAU;
        for (let i = 0; i < 14; i++) {
          x += Math.cos(dir + R(r, -0.4, 0.4)) * maxR / 12;
          y += Math.sin(dir + R(r, -0.4, 0.4)) * maxR / 12;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(lay(0.95), 0.5);
        ctx.lineWidth = Math.max(1, U * 0.0026);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(lay(1), 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, U * 0.008, 0, TAU);
      ctx.fill();
    },

    /* 几何 */
    jihe(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      const bg = hex2rgb(pal.bg[0]);
      ctx.fillStyle = css(bg);
      ctx.fillRect(0, 0, W, H);
      const cols = Math.max(2, Math.round(2 + prm.layers * 0.7));
      const cell = W / cols, rows = Math.max(1, Math.ceil(H / cell));
      const cs = [...pal.layers.map(hex2rgb), hex2rgb(pal.accent)];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * cell, y = j * cell;
          let c1 = pick(r, cs), c2 = pick(r, cs);
          while (c2 === c1 && cs.length > 1) c2 = pick(r, cs);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cell + 1, cell + 1);
          ctx.clip();
          if (r() < 0.45) { ctx.fillStyle = css(c2); ctx.fillRect(x, y, cell + 1, cell + 1); }
          ctx.translate(x + cell / 2, y + cell / 2);
          ctx.rotate(Math.floor(r() * 4) * (PI / 2));
          ctx.fillStyle = css(c1);
          const h = cell / 2, kind = Math.floor(r() * (prm.detail > 0.5 ? 6 : 4));
          ctx.beginPath();
          if (kind === 0) ctx.arc(0, 0, h * 0.78, 0, TAU);
          else if (kind === 1) ctx.arc(0, h * 0.1, h * 0.9, PI, TAU);
          else if (kind === 2) { ctx.moveTo(-h, -h); ctx.lineTo(h, -h); ctx.arc(-h, -h, cell, 0, PI / 2); }
          else if (kind === 3) { ctx.moveTo(-h, h); ctx.lineTo(h, h); ctx.lineTo(-h, -h); }
          else if (kind === 4) { ctx.arc(0, 0, h * 0.74, 0, TAU); ctx.arc(0, 0, h * 0.42, 0, TAU, true); }
          else { for (let k = 0; k < 3; k++) ctx.rect(-h, -h + k * (cell / 3) + cell * 0.06, cell, cell * 0.14); }
          ctx.fill();
          ctx.restore();
        }
      }
    },

    /* 竹影 */
    zhuying(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      if (prm.sun) blob(S, W * prm.sunX, H * prm.horizon * 0.6, U * 0.5, hex2rgb(pal.glow), 0.4);
      const stalks = Math.max(2, Math.round(prm.layers * 1.1));
      for (let s = 0; s < stalks; s++) {
        const t = stalks > 1 ? s / (stalks - 1) : 1;
        // 按序分布，避免全挤在一处
        const x0 = ((s + 0.5) / stalks) * W * 1.1 - W * 0.05 + U * R(r, -0.07, 0.07);
        const lean = U * R(r, -0.12, 0.12) * (0.4 + prm.relief);
        const wd = U * lerp(0.009, 0.028, t) * (0.6 + prm.detail * 0.8);
        const alpha = lerp(0.35, 0.95, t), color = lay(t);
        const X = (y) => x0 + lean * (1 - y / H);
        ctx.fillStyle = rgba(color, alpha);
        let y = H * 1.05;
        const nodes = [];
        while (y > -H * 0.05) {
          const y2 = y - U * R(r, 0.16, 0.26);
          taper(S, [[X(y - 2), y - 2], [X((y + y2) / 2), (y + y2) / 2], [X(y2 + 2), y2 + 2]], wd, (k) => 1 - 0.1 * Math.sin(PI * k));
          ctx.fillRect(X(y2) - wd * 0.72, y2 - wd * 0.12, wd * 1.44, Math.max(1, wd * 0.22));
          nodes.push([X(y2), y2]);
          y = y2;
        }
        nodes.forEach(([nx, ny]) => {
          if (r() < 0.45 || ny > H * 0.9) return;
          const side = r() < 0.5 ? -1 : 1, bl = U * R(r, 0.05, 0.11);
          const ex = nx + side * bl, ey = ny - U * R(r, 0.01, 0.06);
          ctx.strokeStyle = rgba(color, alpha);
          ctx.lineWidth = Math.max(1, wd * 0.2);
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.quadraticCurveTo(nx + side * bl * 0.5, ny - U * 0.004, ex, ey);
          ctx.stroke();
          const leaves = Math.round(R(r, 2, 5));
          for (let k = 0; k < leaves; k++) {
            const ang = ((side > 0 ? R(r, 10, 100) : R(r, 80, 170)) * PI) / 180;
            const len = U * R(r, 0.08, 0.17) * (0.5 + t * 0.6);
            const cs2 = Math.cos(ang), sn = Math.sin(ang), bend = R(r, -0.16, 0.16) * len;
            taper(S, bezPts([ex, ey],
              [ex + cs2 * len * 0.33 - sn * bend, ey + sn * len * 0.33 + cs2 * bend],
              [ex + cs2 * len * 0.66 - sn * bend, ey + sn * len * 0.66 + cs2 * bend],
              [ex + cs2 * len, ey + sn * len], 12), len * 0.17, P_LEAF);
          }
        });
      }
    },

    /* 流光 · 弥散渐变 */
    liuguang(S) {
      const { ctx, W, H, U, L, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      // 取配色里差异最大的几个颜色，避免糊成一团
      const cs = [pal.layers[1], pal.layers[3], pal.accent, pal.glow, pal.layers[4]].map(hex2rgb);
      const n = Math.round(4 + prm.layers * 1.4);
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1);
        const x = W * R(r, -0.1, 1.1), y = H * R(r, -0.08, 1.08);
        const rad = L * lerp(0.46, 0.2, t) * (0.55 + prm.relief * 0.8);
        blob(S, x, y, rad, cs[i % cs.length], lerp(0.8, 0.45, t) * (0.55 + prm.detail * 0.6),
          [[0, 0.85], [0.35, 0.45], [0.7, 0.14], [1, 0]]);
      }
      // 一道柔和高光
      if (prm.sun) blob(S, W * prm.sunX, H * prm.horizon * 0.55, L * 0.42, hex2rgb(pal.glow), 0.5, [[0, 0.7], [0.4, 0.25], [1, 0]]);
      // 轻微统一色调
      if (prm.mist > 0.02) {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, rgba(hex2rgb(pal.bg[1]), 0.26 * prm.mist));
        g.addColorStop(1, rgba(hex2rgb(pal.bg[0]), 0.26 * prm.mist));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    },

    /* 留白 · 大面积空，只在一角着墨 */
    liubai(S) {
      const { ctx, W, H, U, r, pal, prm, lay } = S;
      skyGradient(S, hex2rgb(pal.bg[0]), hex2rgb(pal.bg[1]));
      const hz = clamp(prm.horizon, 0.5, 0.95);
      if (prm.sun) sunDisc(S, W * prm.sunX, H * hz * 0.38, U * 0.06, hex2rgb(pal.accent), hex2rgb(pal.glow), 0.85);
      // 山只占一角，从画面底边长出来
      const right = prm.sunX < 0.5;
      const n = Math.max(2, Math.round(prm.layers * 0.7));
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 1;
        const base = H * lerp(1.0, 1.06, t);
        const hh = U * lerp(0.3, 0.15, t) * (0.5 + prm.relief * 0.8) * (1 - t * 0.2);
        const span = hh * R(r, 1.5, 2.6);
        const cx = right ? W - U * R(r, 0, 0.2) + span * 0.22 : U * R(r, 0, 0.2) - span * 0.22;
        ctx.fillStyle = rgba(lay(t), lerp(0.5, 1, t));
        ctx.beginPath();
        ctx.moveTo(cx - span, base);
        ctx.quadraticCurveTo(cx - span * 0.3, base - hh * 1.08, cx, base - hh);
        ctx.quadraticCurveTo(cx + span * 0.35, base - hh * 0.92, cx + span, base);
        ctx.closePath();
        ctx.fill();
        if (prm.detail > 0.4 && i === n - 1) {
          pine(S, cx + span * R(r, -0.3, 0.3), base - hh * R(r, 0.55, 0.8), U * 0.07, lay(1), 0.9);
        }
        if (prm.mist > 0.02) mistBand(S, base - hh * 0.25, U * 0.06 * (0.4 + prm.mist), hex2rgb(pal.bg[1]), 0.35 * prm.mist);
      }
      // 散落的飞鸟，撑起空白
      const cnt = Math.round(2 + prm.detail * 5);
      for (let i = 0; i < cnt; i++) {
        birds(S, W * R(r, 0.12, 0.88), H * R(r, 0.1, 0.5), 1, lay(0.9), U * R(r, 0.022, 0.05), R(r, 0.3, 0.75));
      }
      if (prm.birds) birds(S, W * (right ? 0.2 : 0.56), H * 0.2, 4, lay(1), U * 0.034, 0.6);
    },
  };

  /* ---------------- 后处理 ---------------- */
  let grainTile = null, grainSeed = null;
  function grain(S) {
    const { ctx, W, H, prm } = S;
    const size = 128;
    if (!grainTile || grainSeed !== 1) {
      grainTile = document.createElement('canvas');
      grainTile.width = grainTile.height = size;
      const g = grainTile.getContext('2d');
      const img = g.createImageData(size, size);
      const gr = rng(12345);
      for (let i = 0; i < size * size; i++) {
        const v = (gr() * 255) | 0;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grainSeed = 1;
    }
    ctx.save();
    ctx.globalAlpha = prm.grain * 0.14;
    ctx.globalCompositeOperation = 'overlay';
    const pat = ctx.createPattern(grainTile, 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function vignette(S) {
    const { ctx, W, H, prm, pal } = S;
    const c = hex2rgb(pal.dark ? '#000000' : pal.layers[pal.layers.length - 1]);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(1, rgba(c, prm.vignette * 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- 对外接口 ---------------- */
  const STYLES = [
    { id: 'shan', name: '远山', uses: ['layers', 'relief', 'horizon', 'mist', 'detail', 'sun', 'sunX', 'birds'] },
    { id: 'luori', name: '落日', uses: ['layers', 'relief', 'horizon', 'mist', 'detail', 'sun', 'sunX', 'birds'] },
    { id: 'haiwave', name: '海浪', uses: ['layers', 'relief', 'horizon', 'detail', 'sun', 'sunX', 'birds'] },
    { id: 'yunhai', name: '云海', uses: ['layers', 'relief', 'horizon', 'mist', 'sun', 'sunX', 'birds'] },
    { id: 'xingye', name: '星夜', uses: ['layers', 'relief', 'horizon', 'mist', 'detail', 'sun', 'sunX'] },
    { id: 'liubai', name: '留白', uses: ['layers', 'relief', 'horizon', 'mist', 'detail', 'sun', 'sunX', 'birds'] },
    { id: 'zhuying', name: '竹影', uses: ['layers', 'relief', 'horizon', 'detail', 'sun', 'sunX'] },
    { id: 'dengaoxian', name: '等高线', uses: ['layers', 'relief', 'detail'] },
    { id: 'nianlun', name: '年轮', uses: ['layers', 'relief', 'detail', 'horizon', 'sunX'] },
    { id: 'liuguang', name: '流光', uses: ['layers', 'relief', 'detail', 'mist', 'horizon', 'sun', 'sunX'] },
    { id: 'jihe', name: '几何', uses: ['layers', 'detail'] },
  ];

  const DEFAULTS = {
    layers: 5, relief: 0.55, horizon: 0.62, mist: 0.5,
    detail: 0.5, grain: 0.35, vignette: 0.25,
    sun: true, sunX: 0.3, birds: true,
  };

  function render(ctx, W, H, st) {
    const pal = window.PALETTES.find((p) => p.id === st.palette) || window.PALETTES[0];
    const prm = Object.assign({}, DEFAULTS, st.params);
    const r = rng(st.seed);
    const S = {
      ctx, W, H, U: Math.min(W, H), L: Math.max(W, H),
      r, pal, prm, lay: sampler(pal.layers),
    };
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    (PAINTERS[st.style] || PAINTERS.shan)(S);
    if (prm.vignette > 0.01) vignette(S);
    if (prm.grain > 0.01) grain(S);
    ctx.restore();
  }

  window.Engine = { STYLES, DEFAULTS, render };
})();
