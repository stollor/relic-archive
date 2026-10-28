/* =============================================================================
   遗迹2 · 遗物档案 — icons.js
   全站唯一图标来源（内联 SVG，24×24，线性 1.6）。加图标必须登记到这里 + UX_SPEC §6。
   用法： icon('fire', {size:14, cls:'x', title:'火焰伤害'})
   ========================================================================== */
const NS = 'http://www.w3.org/2000/svg';

/* name -> 内部 SVG 标记（可含多个元素） */
export const ICONS = {
  /* ---------- 基础 / 操作 ---------- */
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4.5 12.5 4.5 4.5L19.5 6.5"/>',
  'chevron-down': '<path d="m7 10 5 5 5-5"/>',
  'chevron-left': '<path d="m14 6-6 6 6 6"/>',
  'chevron-right': '<path d="m10 6 6 6-6 6"/>',
  'arrow-right': '<path d="M4 12h15m0 0-5-5m5 5-5 5"/>',
  'arrow-left': '<path d="M20 12H5m0 0 5-5m-5 5 5 5"/>',
  'arrow-up': '<path d="M12 20V4m0 0-5 5m5-5 5 5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.4"/><path d="M20 5v6h-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/>',
  trash: '<path d="M4 7h16M9.5 7V5h5v2M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M9 4v5h6V4M9 20v-6h6v6"/>',
  warning: '<path d="M12 4 21 20H3Z"/><path d="M12 10v4.5M12 17.4v.6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.5"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.5 2.4c-.7.4-1 .9-1 1.7M12 16.6v.5"/>',
  filter: '<path d="M3.5 5.5h17l-6.5 8V20l-4 1.5V13.5z"/>',
  sort: '<path d="M7.5 5v14M4.5 16l3 3 3-3M16.5 19V5M13.5 8l3-3 3 3"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.6" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.6" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
  swap: '<path d="M5 8h13m0 0-3.5-3.5M18 8l-3.5 3.5M19 16H6m0 0 3.5-3.5M6 16l3.5 3.5"/>',
  hash: '<path d="M9.5 4 7.8 20M16.2 4l-1.7 16M4.5 9h15.5M3.5 15h15.5"/>',
  clipboard: '<rect x="6" y="4.5" width="12" height="15.5" rx="2"/><path d="M9.5 4.5V3h5v1.5M9.5 10h5M9.5 13.5h5"/>',
  external: '<path d="M13 4h7v7M20 4l-8.5 8.5M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5"/>',
  eye: '<path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12S18 17.8 12 17.8 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.6 5.3A9.9 9.9 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8M6.4 7.2A17.4 17.4 0 0 0 2.5 12S6 19 12 19a10 10 0 0 0 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'more-h': '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  pin: '<path d="M12 21.5s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.9 12 21.5 12 21.5z"/><circle cx="12" cy="10.6" r="2.4"/>',
  sparkle: '<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z"/><path d="M18.5 16.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  'rotate-ccw': '<path d="M4 11a8 8 0 1 1 2.3 6.4"/><path d="M4 5v6h6"/>',

  /* ---------- 状态 / 拥有 / 收藏 ---------- */
  star: '<path d="m12 4 2.5 5.4 5.5.8-4 4 1 5.6-5-2.8-5 2.8 1-5.6-4-4 5.5-.8z"/>',
  'star-fill': '<path d="m12 4 2.5 5.4 5.5.8-4 4 1 5.6-5-2.8-5 2.8 1-5.6-4-4 5.5-.8z" fill="currentColor" stroke="none"/>',
  owned: '<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><path class="ico-check-on-fill" d="m8 12.2 2.8 2.8L16 9.6" stroke-width="2"/>',
  unowned: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/>',
  'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.2"/>',
  'x-circle': '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',

  /* ---------- 分类 / 槽位 ---------- */
  all: '<circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="7" r="2.4"/><circle cx="7" cy="17" r="2.4"/><circle cx="17" cy="17" r="2.4"/>',
  sword: '<path d="M19.5 4.5v5.6L9.6 20l-2.8-2.8L16.6 7.3"/><path d="M7.6 15.4 4.5 18.5M14.2 6.4l3.4 3.4M4.5 19.5v-3"/>',
  longgun: '<g fill="currentColor" stroke="none"><rect x="1.8" y="11.2" width="11.2" height="1.9" rx="0.6"/><rect x="12.2" y="9.6" width="5.6" height="3.6" rx="0.7"/><path d="M18.2 10h1.2l2.4 2.2-1.8 2.4h-1.8z"/><path d="M9.2 13.3h2.4l-1.1 4.5H8z"/></g>',
  handgun: '<g fill="currentColor" stroke="none"><rect x="4" y="8.2" width="12" height="3.3" rx="0.7"/><rect x="15.4" y="9.1" width="4.8" height="1.5" rx="0.5"/><path d="M8 11.7h4.6l-1 6.6H7.2z"/></g>',
  armor: '<path d="M12 3 4.5 6v5.6c0 4.6 3.3 7.4 7.5 9.4 4.2-2 7.5-4.8 7.5-9.4V6z"/><path d="M12 7.5v9M8.5 10.5h7"/>',
  helmet: '<path d="M5 15V11a7 7 0 0 1 14 0v4"/><path d="M5 15h14v3H5z"/><path d="M9.5 15v-3.5h5V15"/>',
  chest: '<path d="M12 3.4 8.6 5.4H5v4.4l-1 1.6v9h5.2v-6.2h3.8v6.2H18v-9l-1-1.6V5.4h-3.6z" fill="currentColor" stroke="none"/>',
  legs: '<g fill="currentColor" stroke="none"><path d="M6.4 3.6h3.8l-.5 6.4-1.1 10.4H5.6z"/><path d="M13.8 3.6h3.8l.8 16.8h-3z"/></g>',
  gloves: '<path d="M8.4 20.6v-5.4l-1.9-1.7a2 2 0 0 1 2.8-2.9l1.5 1.5V4.7a1.95 1.95 0 0 1 3.9 0v6.1l1.3-1.3a1.95 1.95 0 0 1 2.9 2.7l-2.7 2.7v5.7z" fill="currentColor" stroke="none"/>',
  amulet: '<path d="M6 4c0 5 2 7 6 7s6-2 6-7"/><path d="m12 11 3 4-3 5-3-5z"/>',
  ring: '<circle cx="12" cy="14.5" r="5.8"/><path d="m9.2 9.2 2.8-3.7 2.8 3.7z"/>',
  mod: '<rect x="5" y="7.5" width="14" height="9" rx="2"/><path d="M9.5 7.5V4.5M14.5 7.5V4.5M9.5 19.5v-3M14.5 19.5v-3M5 12H2.2M21.8 12H19"/>',
  trait: '<path d="m12 3.5 3 6.5 6.5 2-6.5 2-3 6.5-3-6.5-6.5-2 6.5-2z"/>',
  perk: '<path d="m12 3.2 7.4 4.3v9L12 20.8l-7.4-4.3v-9z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  skill: '<path d="M13 3 5.5 14H11l-1 7 8-11h-5.5z"/>',
  consumable: '<path d="M9.5 3h5M10.5 3v5L6.6 16a2.7 2.7 0 0 0 2.4 4h6a2.7 2.7 0 0 0 2.4-4L13.5 8V3"/><path d="M7.6 15h8.8"/>',
  gem: '<path d="M7 4h10l4 6-9 11L3 10z"/><path d="M3 10h18M9 4 7 10l5 11 5-11-2-6"/>',
  metagem: '<path d="M12 3 20 12l-8 9-8-9z"/><path d="M12 8.2 15.6 12 12 15.8 8.4 12z"/>',
  engram: '<path d="M6 3.5h9l4 4v13H6z"/><path d="M15 3.5v4h4M9 12h7M9 16h5"/>',
  material: '<path d="m5 8.5 7-4.5 7 4.5v8L12 21l-7-4.5z"/><path d="m5 8.5 7 4.5 7-4.5M12 13v8"/><path d="m9.5 6.4 6 3.8"/>',
  relic: '<path d="M8 3.5h8v5a4 4 0 0 1-8 0z"/><path d="M12 12.5v8M8.5 20.5h7M5 7h3M16 7h3"/>',
  archetype: '<circle cx="12" cy="8" r="3.4"/><path d="M4.8 20.5c.6-4 3.6-6 7.2-6s6.6 2 7.2 6"/>',

  /* ---------- 伤害类型 / 战斗 ---------- */
  phys: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2M5.4 5.4l3 3M15.6 15.6l3 3M18.6 5.4l-3 3M8.4 15.6l-3 3"/>',
  fire: '<path d="M12 3c.8 3.6 4.8 5 4.8 9.4a4.8 4.8 0 0 1-9.6 0c0-1.8.8-3.3 1.9-4.7.4 1.4 1.2 2 1.9 2.1.3-2.3.3-4.6 1-6.8z"/><path d="M12 12.5c.9 1 1.4 1.6 1.4 2.6a1.5 1.5 0 0 1-3 0c0-1 .6-1.7 1.6-2.6z"/>',
  bleed: '<path d="M12 3.2s6.2 6.6 6.2 10.6a6.2 6.2 0 0 1-12.4 0C5.8 9.8 12 3.2 12 3.2z"/><path d="M9.5 13.8c0 2 1.2 3 2.5 3"/>',
  shock: '<path d="M13.4 2.5 5.6 13.4H11l-1.2 8.1 8.6-11.2H12.6z"/>',
  corrode: '<path d="M12 3.2s6 6.4 6 10.3a6 6 0 0 1-12 0C6 9.6 12 3.2 12 3.2z"/><circle cx="10" cy="13" r="1.5"/><circle cx="14" cy="15.6" r="1"/>',
  blight: '<circle cx="12" cy="12" r="5"/><path d="M12 2.6v4M12 17.4v4M2.6 12h4M17.4 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M18.5 5.5l-2.8 2.8M8.3 15.7l-2.8 2.8"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  crit: '<circle cx="12" cy="12" r="8.4"/><path d="m12 7.2 1.4 3.4 3.4 1.4-3.4 1.4L12 16.8l-1.4-3.4L7.2 12l3.4-1.4z" fill="currentColor" stroke="none"/>',
  weakspot: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  damage: '<path d="m12 3 2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1z"/>',
  armorstat: '<path d="M12 3 4.5 6v5.6c0 4.6 3.3 7.4 7.5 9.4 4.2-2 7.5-4.8 7.5-9.4V6z"/><path d="M12 7.5v9M8.5 10.5h7"/>',
  resist: '<path d="M12 3 4.5 6v5.6c0 4.6 3.3 7.4 7.5 9.4 4.2-2 7.5-4.8 7.5-9.4V6z"/><path d="M7.8 12.4c1.4-1.6 2.8-1.6 4.2 0s2.8 1.6 4.2 0"/>',
  weight: '<path d="M4 8.5v7M7 6.5v11M17 6.5v11M20 8.5v7M7 12h10"/>',
  stamina: '<rect x="2.5" y="8" width="16" height="8.5" rx="2"/><path d="M21 10.5v3.5"/><path d="M11.6 9.6 8.4 13h2.6l-.6 2.9 3.4-3.6h-2.6z" fill="currentColor" stroke="none"/>',
  dodge: '<path d="M4.5 19a7.5 7.5 0 1 1 3.2 1.9"/><path d="M4.5 15v4h4"/><circle cx="14" cy="9" r="2.2"/>',
  health: '<path d="M12 20.5S3.8 15.6 3.8 9.9A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 8.2 2.3c0 5.7-8.2 10.6-8.2 10.6z"/>',
  shield: '<path d="M12 3 4.5 6v5.6c0 4.6 3.3 7.4 7.5 9.4 4.2-2 7.5-4.8 7.5-9.4V6z"/>',
  bulwark: '<path d="M12 3 4.5 6v5.6c0 4.6 3.3 7.4 7.5 9.4 4.2-2 7.5-4.8 7.5-9.4V6z"/><path d="M7.2 9.4h9.6M7.2 12.6h9.6M10.6 6.6v3M13.4 12.6v3"/>',
  firerate: '<path d="M4 7.5h9M4 12h12M4 16.5h9"/><path d="m15 9.5 3 2.5-3 2.5M18.5 6.5 22 12l-3.5 5.5"/>',
  mag: '<rect x="6.5" y="4" width="11" height="16" rx="1.6"/><path d="M9.5 7.5h5M9.5 10.5h5M9.5 13.5h5M9.5 16.5h5"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  movespeed: '<path d="M4 7.5h6.5M4 12h9M4 16.5h6.5"/><path d="m13.5 8.5 3 3.5-3 3.5M17 8.5l3 3.5-3 3.5"/>',
  modpower: '<circle cx="12" cy="12" r="7.8"/><path d="m13 7.4-3.4 5.4h2.6l-.9 3.8 3.4-5.4h-2.6z" fill="currentColor" stroke="none"/>',

  /* ---------- 获取途径 ---------- */
  shop: '<path d="M4.5 8h15l-1.2 11H5.7z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  pickup: '<path d="M12 21s6.4-5.6 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 15.4 12 21 12 21z"/><circle cx="12" cy="10.4" r="2.3"/>',
  craft: '<path d="M15.6 4.6a4.1 4.1 0 0 0-5.6 5.4L4 16v4h4l5.9-6a4.1 4.1 0 0 0 5.4-5.6l-2.9 2.9-2.1-2.1z"/>',
  boss: '<path d="M12 3.2a7 7 0 0 0-7 7c0 2 .8 3.4 1.9 4.4v4.4h10.2v-4.4c1.1-1 1.9-2.4 1.9-4.4a7 7 0 0 0-7-7z"/><circle cx="9.4" cy="10.6" r="1.5" fill="currentColor" stroke="none"/><circle cx="14.6" cy="10.6" r="1.5" fill="currentColor" stroke="none"/><path d="M10.4 15.4h3.2"/>',
  rng: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none"/>',
  puzzle: '<circle cx="8.6" cy="8.6" r="3.1"/><path d="M11 11 20 20M17.2 17.2l2-2M14.4 14.4l2-2"/>',

  /* ---------- 领域 / 页面 ---------- */
  library: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12.5v15.5H7A2.5 2.5 0 0 0 4.5 21z"/><path d="M4.5 5.5V21M8.5 7.5h7M8.5 11.5h7"/>',
  flask: '<path d="M9 3h6M10.2 3v5.6L5.6 17a3 3 0 0 0 2.7 4.2h7.4A3 3 0 0 0 18.4 17l-4.6-8.4V3"/><path d="M7.4 15.6c2.2-1.6 6.9 1.4 9.2 0"/>',
  book: '<path d="M12 6.4C10.2 4.9 7.4 4.4 3.5 4.6v13.9c3.9-.2 6.7.3 8.5 1.8 1.8-1.5 4.6-2 8.5-1.8V4.6c-3.9-.2-6.7.3-8.5 1.8z"/><path d="M12 6.4v13.9"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7.5h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  matrix: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9.3h17M3.5 14.6h17M9 4v16M15 4v16"/>',
  chart: '<path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3.2" height="6" rx="0.7"/><rect x="12" y="8.5" width="3.2" height="9.5" rx="0.7"/><rect x="17" y="5.5" width="3.2" height="12.5" rx="0.7"/>',
  scale: '<path d="M12 4v16M7 20h10M12 6.5 5 9l2.6 5.6L12 12zM12 6.5 19 9l-2.6 5.6L12 12z"/>',
  listchecks: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.6 6.3 1.2 1.2 2-2.2M3.6 11.8l1.2 1.2 2-2.2M3.6 17.3l1.2 1.2 2-2.2"/>',

  /* ---------- 流派（配装推荐） ---------- */
  /* 与顶栏「流派」导航同一形状：叠放的配装卡 + 星 */
  builds: '<rect x="7.6" y="3.6" width="10.8" height="14.6" rx="2"/><path d="M4.9 7.2v11.2a2 2 0 0 0 2 2h7.6"/><path d="m13 7.6 1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" fill="currentColor" stroke="none"/>',
  loop: '<path d="M4.6 9.4A7.6 7.6 0 0 1 19 8.2"/><path d="M19.2 4.4v4.2h-4.2"/><path d="M19.4 14.6A7.6 7.6 0 0 1 5 15.8"/><path d="M4.8 19.6v-4.2h4.2"/>',
  trophy: '<path d="M8 4h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 5.4H5.4v1.8a3 3 0 0 0 3 3M16 5.4h2.6v1.8a3 3 0 0 1-3 3"/><path d="M12 12.8V17M8.6 20.4h6.8M10.2 17h3.6"/>',
  layers: '<path d="M12 3.4 20 7.6 12 11.8 4 7.6z"/><path d="m4 12 8 4.2 8-4.2M4 16.4l8 4.2 8-4.2"/>',
};

/** 生成图标元素 */
export function icon(name, opts = {}) {
  const { size = 16, cls = '', title = '', stroke = 1.6 } = opts;
  const body = ICONS[name] || ICONS.question;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');
  if (cls) svg.setAttribute('class', cls);
  if (title) {
    svg.setAttribute('role', 'img');
    const t = document.createElementNS(NS, 'title');
    t.textContent = title;
    svg.append(t);
  }
  svg.innerHTML = body;
  return svg;
}

export const ICON_NAMES = Object.keys(ICONS);
