/* ==========================================================
   配色方案 + 设备尺寸预设
   ----------------------------------------------------------
   · layers 按"由远到近"排列（远景浅、近景深），
     引擎会在这组颜色上插值，所以层数可以任意调。
   · 想加自己的配色，照格式往 PALETTES 里加一条即可。
   ========================================================== */

window.PALETTES = [
  { id: 'xuanzhi', name: '宣纸', dark: false,
    bg: ['#f6f2e7', '#eae2d1'],
    layers: ['#d2cbbb', '#ada48f', '#827a6a', '#565044', '#2e2a23'],
    accent: '#bd4a39', glow: '#e8c9a8' },

  { id: 'yemo', name: '夜墨', dark: true,
    bg: ['#0e1014', '#1b2028'],
    layers: ['#262c35', '#333b46', '#454f5c', '#5c6775', '#8f9aa8'],
    accent: '#ece3cb', glow: '#aebbcd' },

  { id: 'mushan', name: '暮山', dark: false,
    bg: ['#fbe6cf', '#f3b89b'],
    layers: ['#e9b79d', '#d99381', '#b16f6d', '#7e5460', '#46333f'],
    accent: '#e4583c', glow: '#ffd9a8' },

  { id: 'qingci', name: '青瓷', dark: false,
    bg: ['#eef3ee', '#d9e6e2'],
    layers: ['#c4d8d3', '#a3c1bc', '#7fa6a2', '#5a8582', '#33575a'],
    accent: '#d98b5f', glow: '#f0e2c4' },

  { id: 'morandi', name: '莫兰迪', dark: false,
    bg: ['#f1ece6', '#e2dad2'],
    layers: ['#d6cdc4', '#bfb2a7', '#a3968f', '#857a78', '#5d5558'],
    accent: '#a8705f', glow: '#e7d3c0' },

  { id: 'songyan', name: '松烟', dark: true,
    bg: ['#101614', '#1a2420'],
    layers: ['#22302b', '#2d4038', '#3c5649', '#51705f', '#7d9a85'],
    accent: '#d8bb7a', glow: '#9fc0a6' },

  { id: 'ying', name: '樱', dark: false,
    bg: ['#fdf0f1', '#f6dee1'],
    layers: ['#f0cdd3', '#e0acb6', '#c88a9a', '#a06a7e', '#6b4659'],
    accent: '#d8566f', glow: '#ffe0e4' },

  { id: 'haiyan', name: '海盐', dark: false,
    bg: ['#f0f5f8', '#d8e6ef'],
    layers: ['#c3d9e6', '#9dc0d4', '#74a2bd', '#4d7d9c', '#2b506b'],
    accent: '#ef9f55', glow: '#fff0d2' },

  { id: 'shuguang', name: '曙光', dark: true,
    bg: ['#141229', '#3a2a4e'],
    layers: ['#2d2347', '#43305a', '#5f4069', '#86526f', '#c4766f'],
    accent: '#ffd18a', glow: '#ff9e7a' },

  { id: 'kafei', name: '焙茶', dark: false,
    bg: ['#f4ece2', '#e7d8c6'],
    layers: ['#dbc7b0', '#c2a689', '#a3815f', '#7c5d43', '#4a3528'],
    accent: '#b4532f', glow: '#f3dcb8' },
];

/* 设备尺寸：w / h 为真实像素 */
window.SIZE_GROUPS = [
  {
    name: '手机',
    items: [
      { id: 'ip16pm', label: 'iPhone 16 Pro Max', w: 1320, h: 2868 },
      { id: 'ip16p', label: 'iPhone 16 / 15 Pro', w: 1179, h: 2556 },
      { id: 'ipse', label: 'iPhone SE', w: 750, h: 1334 },
      { id: 'and2k', label: '安卓 2K（1440×3200）', w: 1440, h: 3200 },
      { id: 'and1080', label: '安卓 1080（1080×2400）', w: 1080, h: 2400 },
    ],
  },
  {
    name: '平板',
    items: [
      { id: 'ipadpro', label: 'iPad Pro 12.9', w: 2048, h: 2732 },
      { id: 'ipadair', label: 'iPad Air', w: 1640, h: 2360 },
    ],
  },
  {
    name: '电脑',
    items: [
      { id: 'fhd', label: '1080P（1920×1080）', w: 1920, h: 1080 },
      { id: 'qhd', label: '2K（2560×1440）', w: 2560, h: 1440 },
      { id: 'uhd', label: '4K（3840×2160）', w: 3840, h: 2160 },
      { id: 'uw', label: '带鱼屏（3440×1440）', w: 3440, h: 1440 },
      { id: 'mbp16', label: 'MacBook Pro 16', w: 3456, h: 2234 },
      { id: 'mbp14', label: 'MacBook Pro 14', w: 3024, h: 1964 },
    ],
  },
];
