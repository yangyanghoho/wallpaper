/* ==========================================================
   造景 · 界面逻辑
   状态 → 预览渲染 → 导出真实分辨率图片
   ========================================================== */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const root = document.documentElement;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rint = (n) => Math.floor(Math.random() * n);
  const STYLES = Engine.STYLES, PALETTES = window.PALETTES, GROUPS = window.SIZE_GROUPS;
  const ALL_SIZES = GROUPS.flatMap((g) => g.items);

  /* ---------- 参数定义 ---------- */
  const SLIDERS = [
    { key: 'layers', name: '层数', min: 2, max: 7, step: 1, fmt: (v) => v },
    { key: 'relief', name: '起伏', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'horizon', name: '地平线', min: 0.2, max: 0.95, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'mist', name: '雾气', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'detail', name: '细节', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'sunX', name: '日月位置', min: 0.05, max: 0.95, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'grain', name: '颗粒', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'vignette', name: '暗角', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  ];
  // 颗粒和暗角对所有风格都有效
  const ALWAYS = ['grain', 'vignette'];

  /* ---------- 状态 ---------- */
  const state = {
    style: 'shan',
    palette: 'xuanzhi',
    seed: 1 + rint(999999),
    sizeId: 'ip16p',
    w: 1179,
    h: 2556,
    params: Object.assign({}, Engine.DEFAULTS),
  };

  function currentSize() {
    if (state.sizeId === 'custom') return { w: state.w, h: state.h, label: '自定义' };
    const s = ALL_SIZES.find((x) => x.id === state.sizeId) || ALL_SIZES[0];
    // 预设支持横竖互换
    const flipped = state.w && state.h && (state.w !== s.w || state.h !== s.h) && state.w === s.h && state.h === s.w;
    return flipped ? { w: s.h, h: s.w, label: s.label + '（横）' } : { w: s.w, h: s.h, label: s.label };
  }

  /* ---------- URL 读写 ---------- */
  function toURL() {
    const p = new URLSearchParams();
    p.set('s', state.style);
    p.set('c', state.palette);
    p.set('d', state.seed);
    p.set('z', state.sizeId);
    p.set('w', state.w);
    p.set('h', state.h);
    SLIDERS.forEach((s) => p.set(s.key, round(state.params[s.key])));
    p.set('sun', state.params.sun ? 1 : 0);
    p.set('bird', state.params.birds ? 1 : 0);
    return location.origin + location.pathname + '#' + p.toString();
  }
  const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

  function fromURL() {
    if (!location.hash.length) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('s')) return false;
    if (STYLES.some((s) => s.id === p.get('s'))) state.style = p.get('s');
    if (PALETTES.some((c) => c.id === p.get('c'))) state.palette = p.get('c');
    const d = +p.get('d');
    if (Number.isFinite(d) && d > 0) state.seed = d | 0;
    const z = p.get('z');
    if (z === 'custom' || ALL_SIZES.some((s) => s.id === z)) state.sizeId = z;
    const w = +p.get('w'), h = +p.get('h');
    if (w > 63 && h > 63) { state.w = clamp(w | 0, 64, 8000); state.h = clamp(h | 0, 64, 8000); }
    SLIDERS.forEach((s) => {
      const v = parseFloat(p.get(s.key));
      if (Number.isFinite(v)) state.params[s.key] = clamp(v, s.min, s.max);
    });
    if (p.get('sun') !== null) state.params.sun = p.get('sun') === '1';
    if (p.get('bird') !== null) state.params.birds = p.get('bird') === '1';
    return true;
  }

  /* ---------- 主题 ---------- */
  const metaTheme = $('#metaTheme'), themeBtn = $('#themeBtn');
  const tStore = {
    get() { try { return localStorage.getItem('zaojing-theme'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('zaojing-theme', v); } catch (e) {} },
  };
  function applyTheme(t) {
    root.dataset.theme = t;
    metaTheme.content = t === 'dark' ? '#15171a' : '#f4f1ec';
    themeBtn.setAttribute('aria-pressed', String(t === 'dark'));
  }
  applyTheme(root.dataset.theme || 'light');
  themeBtn.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    tStore.set(next);
    applyTheme(next);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!tStore.get()) applyTheme(e.matches ? 'dark' : 'light');
  });

  /* ---------- 预览渲染 ---------- */
  const cv = $('#preview'), ctx = cv.getContext('2d'), frame = $('#frame'), wrap = $('#canvasWrap');
  const MAX_PREVIEW_PX = 2.6e6; // 预览最多渲染这么多像素，保证流畅

  function previewBox() {
    const { w, h } = currentSize();
    const pad = 36;
    const availW = Math.max(160, wrap.clientWidth - pad);
    const availH = clamp(innerHeight * (innerWidth < 1000 ? 0.52 : 0.6), 240, 820);
    const k = Math.min(availW / w, availH / h);
    return { cssW: Math.round(w * k), cssH: Math.round(h * k) };
  }

  function drawPreview() {
    const { w, h } = currentSize();
    const { cssW, cssH } = previewBox();
    let scale = Math.min(window.devicePixelRatio || 1, 2);
    if (cssW * cssH * scale * scale > MAX_PREVIEW_PX) scale = Math.sqrt(MAX_PREVIEW_PX / (cssW * cssH));
    const bw = Math.max(1, Math.round(cssW * scale)), bh = Math.max(1, Math.round(cssH * scale));
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    // frame 上有 container-type: inline-size（内联轴尺寸不由内容决定），
    // 必须显式给宽高，否则会塌成 0
    frame.style.width = cssW + 'px';
    frame.style.height = cssH + 'px';
    Engine.render(ctx, bw, bh, state);

    $('#sizeLabel').textContent = currentSize().label;
    $('#sizePx').textContent = `${w} × ${h}`;
    $('#seedText').textContent = state.seed;
    // 竖屏且比例接近手机时才显示锁屏参考
    $('#guideChk').disabled = h / w < 1.3;
    history.replaceState(null, '', toURL());
  }

  /* ---------- 风格卡 ---------- */
  const styleGrid = $('#styleGrid');
  styleGrid.innerHTML = STYLES.map((s) => `
    <button class="style-item" role="radio" type="button" data-id="${s.id}" aria-checked="${s.id === state.style}">
      <canvas width="112" height="78"></canvas><span>${s.name}</span>
    </button>`).join('');

  function drawStyleThumbs() {
    $$('.style-item', styleGrid).forEach((btn) => {
      const c = $('canvas', btn);
      Engine.render(c.getContext('2d'), c.width, c.height, {
        style: btn.dataset.id, palette: state.palette, seed: 24680,
        params: Object.assign({}, state.params, { grain: 0, vignette: 0.15 }),
      });
    });
  }
  styleGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.style-item');
    if (!btn) return;
    setStyle(btn.dataset.id);
  });
  function setStyle(id) {
    state.style = id;
    $$('.style-item', styleGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id)));
    syncSliders();
    refresh();
  }

  /* ---------- 配色 ---------- */
  const palGrid = $('#palGrid');
  palGrid.innerHTML = PALETTES.map((p) => `
    <button class="pal-item" role="radio" type="button" data-id="${p.id}" aria-checked="${p.id === state.palette}">
      <span class="sw" aria-hidden="true">${[p.bg[0], p.layers[1], p.layers[3], p.accent].map((c) => `<i style="background:${c}"></i>`).join('')}</span>
      ${p.name}
    </button>`).join('');
  palGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.pal-item');
    if (!btn) return;
    setPalette(btn.dataset.id);
  });
  function setPalette(id) {
    state.palette = id;
    $$('.pal-item', palGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id)));
    refresh();
    drawStyleThumbs();
  }

  /* ---------- 尺寸 ---------- */
  const sizeSel = $('#sizeSel'), customBox = $('#customBox'), cwEl = $('#cw'), chEl = $('#ch');
  sizeSel.innerHTML = GROUPS.map((g) => `<optgroup label="${g.name}">${g.items.map((s) => `<option value="${s.id}">${s.label}　${s.w}×${s.h}</option>`).join('')}</optgroup>`).join('')
    + '<option value="custom">自定义尺寸…</option>';
  sizeSel.value = state.sizeId;

  sizeSel.addEventListener('change', () => {
    state.sizeId = sizeSel.value;
    if (state.sizeId === 'custom') {
      customBox.hidden = false;
      cwEl.value = state.w;
      chEl.value = state.h;
    } else {
      customBox.hidden = true;
      const s = ALL_SIZES.find((x) => x.id === state.sizeId);
      state.w = s.w; state.h = s.h;
    }
    refresh();
  });
  const onCustom = () => {
    state.w = clamp(parseInt(cwEl.value, 10) || 64, 64, 8000);
    state.h = clamp(parseInt(chEl.value, 10) || 64, 64, 8000);
    refresh();
  };
  cwEl.addEventListener('change', onCustom);
  chEl.addEventListener('change', onCustom);
  $('#rotateBtn').addEventListener('click', () => {
    const t = state.w; state.w = state.h; state.h = t;
    if (state.sizeId !== 'custom') {
      const s = ALL_SIZES.find((x) => x.id === state.sizeId);
      // 与预设不一致时标记为自定义之外的"横版预设"，仍保留预设名
      if (!s || (state.w !== s.w && state.w !== s.h)) state.sizeId = 'custom';
    }
    if (state.sizeId === 'custom') { customBox.hidden = false; sizeSel.value = 'custom'; cwEl.value = state.w; chEl.value = state.h; }
    refresh();
  });

  /* ---------- 滑块 ---------- */
  const slidersEl = $('#sliders');
  slidersEl.innerHTML = SLIDERS.map((s) => `
    <div class="slider" data-key="${s.key}">
      <label class="slider-head" for="sl-${s.key}"><b>${s.name}</b><span id="sv-${s.key}"></span></label>
      <input type="range" id="sl-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${state.params[s.key]}" />
    </div>`).join('');

  SLIDERS.forEach((s) => {
    const input = $(`#sl-${s.key}`);
    input.addEventListener('input', () => {
      state.params[s.key] = s.step >= 1 ? parseInt(input.value, 10) : parseFloat(input.value);
      $(`#sv-${s.key}`).textContent = s.fmt(state.params[s.key]);
      drawPreview();
      scheduleVariations();
    });
  });
  $('#sunChk').addEventListener('change', (e) => { state.params.sun = e.target.checked; refresh(); });
  $('#birdChk').addEventListener('change', (e) => { state.params.birds = e.target.checked; refresh(); });
  $('#resetBtn').addEventListener('click', () => {
    state.params = Object.assign({}, Engine.DEFAULTS);
    syncSliders();
    refresh();
    drawStyleThumbs();
    toast('参数已恢复默认');
  });

  // 按当前风格显示相关参数
  function syncSliders() {
    const uses = (STYLES.find((s) => s.id === state.style) || STYLES[0]).uses;
    SLIDERS.forEach((s) => {
      const on = ALWAYS.includes(s.key) || uses.includes(s.key);
      $(`.slider[data-key="${s.key}"]`).classList.toggle('off', !on);
      const input = $(`#sl-${s.key}`);
      input.value = state.params[s.key];
      $(`#sv-${s.key}`).textContent = s.fmt(state.params[s.key]);
    });
    $('#sunChk').checked = !!state.params.sun;
    $('#birdChk').checked = !!state.params.birds;
    $('#sunChk').closest('.switch').style.display = uses.includes('sun') ? '' : 'none';
    $('#birdChk').closest('.switch').style.display = uses.includes('birds') ? '' : 'none';
  }

  /* ---------- 变体条 ---------- */
  const varRow = $('#varRow');
  let varTimer = null;
  const scheduleVariations = () => { clearTimeout(varTimer); varTimer = setTimeout(drawVariations, 260); };

  function drawVariations() {
    const { w, h } = currentSize();
    const tw = 112, th = Math.round(clamp((tw * h) / w, 60, 210));
    varRow.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const seed = 1 + rint(999999);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v-item';
      btn.title = '采用这个构图';
      btn.setAttribute('aria-label', `采用构图 ${i + 1}`);
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      Engine.render(c.getContext('2d'), tw, th, {
        style: state.style, palette: state.palette, seed,
        params: Object.assign({}, state.params, { grain: 0 }),
      });
      btn.appendChild(c);
      btn.addEventListener('click', () => { state.seed = seed; drawPreview(); toast('已采用这个构图'); });
      varRow.appendChild(btn);
    }
  }

  /* ---------- 刷新 ---------- */
  function refresh() {
    drawPreview();
    scheduleVariations();
  }

  /* ---------- 随机 ---------- */
  $('#rollBtn').addEventListener('click', roll);
  function roll() {
    state.seed = 1 + rint(999999);
    state.palette = PALETTES[rint(PALETTES.length)].id;
    const p = state.params;
    p.layers = 3 + rint(5);
    p.relief = 0.25 + Math.random() * 0.7;
    p.horizon = 0.42 + Math.random() * 0.45;
    p.mist = Math.random();
    p.detail = 0.2 + Math.random() * 0.8;
    p.sunX = 0.12 + Math.random() * 0.76;
    p.sun = Math.random() < 0.82;
    p.birds = Math.random() < 0.6;
    $$('.pal-item', palGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.palette)));
    syncSliders();
    refresh();
    drawStyleThumbs();
  }
  $('#seedBtn').addEventListener('click', () => { state.seed = 1 + rint(999999); drawPreview(); scheduleVariations(); });
  $('#paletteBtn').addEventListener('click', () => {
    let id = state.palette;
    while (id === state.palette && PALETTES.length > 1) id = PALETTES[rint(PALETTES.length)].id;
    setPalette(id);
  });

  /* ---------- 导出 ---------- */
  function exportImage(fmt) {
    const { w, h } = currentSize();
    const btn = fmt === 'jpg' ? $('#jpgBtn') : $('#pngBtn');
    btn.disabled = true;
    frame.classList.add('busy');
    toast(`正在生成 ${w}×${h} …`);
    setTimeout(() => {
      try {
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const octx = out.getContext('2d');
        if (fmt === 'jpg') { octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, w, h); }
        Engine.render(octx, w, h, state);
        out.toBlob((blob) => {
          if (!blob) { toast('生成失败，试试调小尺寸'); done(); return; }
          const name = `zaojing-${state.style}-${state.palette}-${state.seed}-${w}x${h}.${fmt}`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          toast(`已保存 ${name.slice(0, 42)}… （${(blob.size / 1048576).toFixed(1)} MB）`);
          done();
        }, fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
      } catch (err) {
        console.error(err);
        toast('生成失败：' + err.message);
        done();
      }
      function done() { btn.disabled = false; frame.classList.remove('busy'); }
    }, 30);
  }
  $('#pngBtn').addEventListener('click', () => exportImage('png'));
  $('#jpgBtn').addEventListener('click', () => exportImage('jpg'));

  $('#linkBtn').addEventListener('click', async () => {
    const url = toURL();
    try {
      await navigator.clipboard.writeText(url);
      toast('链接已复制，打开即是同一张画');
    } catch (e) {
      toast('复制失败，可直接拷贝地址栏');
    }
  });

  /* ---------- 收藏 ---------- */
  const FAV_KEY = 'zaojing-favs';
  const favModal = $('#favModal'), favGrid = $('#favGrid'), favEmpty = $('#favEmpty');
  const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; } };
  const saveFavs = (list) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { toast('本地空间不足，先删几张'); } };

  function thumbURL() {
    const { w, h } = currentSize();
    const tw = 150, th = Math.max(40, Math.round((tw * h) / w));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    Engine.render(c.getContext('2d'), tw, th, state);
    return c.toDataURL('image/jpeg', 0.7);
  }

  $('#saveFavBtn').addEventListener('click', () => {
    const list = loadFavs();
    list.unshift({
      t: Date.now(),
      thumb: thumbURL(),
      st: { style: state.style, palette: state.palette, seed: state.seed, sizeId: state.sizeId, w: state.w, h: state.h, params: Object.assign({}, state.params) },
    });
    saveFavs(list.slice(0, 30));
    updateFavCount();
    toast('已收藏，存在这台设备上');
  });

  function updateFavCount() { $('#favCount').textContent = loadFavs().length; }

  function renderFavs() {
    const list = loadFavs();
    favEmpty.hidden = list.length > 0;
    favGrid.innerHTML = list.map((f, i) => {
      const s = STYLES.find((x) => x.id === f.st.style), p = PALETTES.find((x) => x.id === f.st.palette);
      return `<div class="fav-item">
        <img src="${f.thumb}" alt="收藏 ${i + 1}：${s ? s.name : ''}" data-i="${i}" />
        <button class="fav-x" type="button" data-del="${i}" aria-label="删除这张收藏">✕</button>
        <small>${s ? s.name : '?'} · ${p ? p.name : '?'} · ${f.st.w}×${f.st.h}</small>
      </div>`;
    }).join('');
  }
  favGrid.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const list = loadFavs();
      list.splice(+del.dataset.del, 1);
      saveFavs(list);
      renderFavs();
      updateFavCount();
      return;
    }
    const img = e.target.closest('img[data-i]');
    if (!img) return;
    const f = loadFavs()[+img.dataset.i];
    if (!f) return;
    Object.assign(state, f.st, { params: Object.assign({}, Engine.DEFAULTS, f.st.params) });
    sizeSel.value = ALL_SIZES.some((x) => x.id === state.sizeId) ? state.sizeId : 'custom';
    customBox.hidden = sizeSel.value !== 'custom';
    cwEl.value = state.w; chEl.value = state.h;
    $$('.style-item', styleGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.style)));
    $$('.pal-item', palGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.palette)));
    syncSliders();
    refresh();
    drawStyleThumbs();
    favModal.close();
    toast('已载入收藏');
  });
  $('#favBtn').addEventListener('click', () => { renderFavs(); favModal.showModal(); });
  $('#favClose').addEventListener('click', () => favModal.close());
  $('#helpBtn').addEventListener('click', () => $('#helpModal').showModal());
  $('#helpClose').addEventListener('click', () => $('#helpModal').close());
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.close(); }));

  /* ---------- 锁屏参考 ---------- */
  const guides = $('#guides');
  $('#guideChk').addEventListener('change', (e) => guides.classList.toggle('on', e.target.checked));
  function tickClock() {
    const d = new Date();
    $('#gTime').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('#gDate').textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`;
  }
  tickClock();
  setInterval(tickClock, 30000);

  /* ---------- 提示 ---------- */
  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
  }

  /* ---------- 快捷键 ---------- */
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof Element && t.matches('input, select, textarea, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const open = $$('.modal').some((m) => m.open);
    if (open) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); roll(); return; }
    if (k === 'r') { state.seed = 1 + rint(999999); drawPreview(); scheduleVariations(); }
    else if (k === 'c') { $('#paletteBtn').click(); }
    else if (k === 's') { e.preventDefault(); exportImage('png'); }
    else if (k === 'f') { $('#saveFavBtn').click(); }
    else if (k === 'g') { const c = $('#guideChk'); if (!c.disabled) { c.checked = !c.checked; c.dispatchEvent(new Event('change')); } }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const i = STYLES.findIndex((s) => s.id === state.style);
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + STYLES.length) % STYLES.length;
      setStyle(STYLES[n].id);
    }
  });

  /* ---------- 装到桌面 / 离线缓存 ---------- */
  const installBtn = $('#installBtn');
  let installEvent = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!installEvent) return;
      installBtn.hidden = true;
      try {
        installEvent.prompt();
        const r = await installEvent.userChoice;
        if (r && r.outcome === 'accepted') toast('已装到桌面，断网也能用');
      } catch (e) {}
      installEvent = null;
    });
  }
  addEventListener('appinstalled', () => {
    if (installBtn) installBtn.hidden = true;
    toast('装好了，可以从桌面直接打开');
  });

  // Service Worker 只能在 http(s) 下注册；本地 file:// 打开时自动跳过
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  /* ---------- 启动 ---------- */
  let rt = null;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawPreview, 160); });

  fromURL();
  sizeSel.value = ALL_SIZES.some((x) => x.id === state.sizeId) ? state.sizeId : 'custom';
  customBox.hidden = sizeSel.value !== 'custom';
  cwEl.value = state.w; chEl.value = state.h;
  $$('.style-item', styleGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.style)));
  $$('.pal-item', palGrid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.palette)));
  syncSliders();
  drawPreview();
  drawStyleThumbs();
  drawVariations();
  updateFavCount();

  // 供自动化检查使用
  window.ZJ = { state, draw: drawPreview, exportImage, STYLES, PALETTES, currentSize };
})();
