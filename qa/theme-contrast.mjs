#!/usr/bin/env node
/* =============================================================================
   遗迹2 · 遗物档案 — 双主题对比度校验（纯 node，零依赖）
   直接从 css/tokens.css 解析 :root（暗色）与 html[data-theme="light"]（亮色）两套 token，
   计算关键前景/背景组合的 WCAG 2.x 对比度：
     · 正文类（t1/t2/t3 × bg-0..3）        ≥ 4.5:1
     · 强调文字（金/青瓷/锈红/苔绿… × bg）  ≥ 4.5:1
     · 金色块（--on-gold × 金/主按钮渐变）  ≥ 4.5:1
     · 徽章（fg × 12% 浅底叠加在卡片上）    ≥ 4.5:1
     · 浮层（scrim / toast / tip / 顶栏玻璃 / 选中底色）≥ 4.5:1
     · UI / 大字号（焦点金环等）            ≥ 3:1
   另做两项一致性检查：亮色是否覆盖了全部颜色 token；theme.js 的 theme-color 兜底值是否 = --bg-0。
   用法：node qa/theme-contrast.mjs        退出码 0=全部通过，1=有失败
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.join(HERE, '..', 'css', 'tokens.css');
const THEME_JS_PATH = path.join(HERE, '..', 'js', 'core', 'theme.js');

/* ------------------------------- 解析 CSS ------------------------------- */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

/** 提取顶层选择器块（跳过 @media 等 at-rule），返回 Map<selector, declText> */
function extractBlocks(css) {
  const blocks = new Map();
  let i = 0;
  let buf = '';
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const selector = buf.trim();
      buf = '';
      const end = findMatchingBrace(css, i);
      if (selector.startsWith('@')) {
        i = end + 1;
        continue;
      }
      const content = css.slice(i + 1, end);
      const prev = blocks.get(selector) || '';
      blocks.set(selector, prev + '\n' + content);
      i = end + 1;
      continue;
    }
    if (ch === '}') {
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  return blocks;
}

function parseDecls(text) {
  const out = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;{}]+)\s*;/gi;
  let m;
  while ((m = re.exec(text))) out.set(m[1], m[2].trim());
  return out;
}

/* ------------------------------- 颜色 ------------------------------- */
const clamp = (v) => Math.min(255, Math.max(0, v));

function parseColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^transparent$/i.test(s)) return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (v, scale) => (/%$/.test(v) ? (parseFloat(v) / 100) * scale : parseFloat(v));
    return {
      r: clamp(num(parts[0], 255)),
      g: clamp(num(parts[1], 255)),
      b: clamp(num(parts[2], 255)),
      a: parts.length > 3 ? clamp(num(parts[3], 1)) : 1,
    };
  }
  return null;
}

function blend(fg, bg) {
  const a = fg.a;
  return {
    r: clamp(fg.r * a + bg.r * (1 - a)),
    g: clamp(fg.g * a + bg.g * (1 - a)),
    b: clamp(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function relLuminance({ r, g, b }) {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(c1, c2) {
  const l1 = relLuminance(c1);
  const l2 = relLuminance(c2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const fmtRGB = (c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

/* ------------------------------- token 解析 ------------------------------- */
const css = stripComments(readFileSync(TOKENS_PATH, 'utf8'));
const blocks = extractBlocks(css);
const rootDecls = parseDecls(blocks.get(':root') || '');
const lightDecls = parseDecls(blocks.get('html[data-theme="light"]') || '');
const darkDecls = new Map([...rootDecls, ...parseDecls(blocks.get('html[data-theme="dark"]') || '')]);

const THEMES = {
  dark: { label: '黑夜', decls: darkDecls },
  light: { label: '白天', decls: new Map([...rootDecls, ...lightDecls]) },
};

const errors = [];

function resolveToken(theme, name, depth = 0) {
  const decls = THEMES[theme].decls;
  const key = name.startsWith('--') ? name : `--${name}`;
  let v = decls.get(key);
  if (v == null) throw new Error(`token ${key} 在 ${theme} 主题未定义`);
  if (depth > 12) throw new Error(`token ${key} 存在循环引用`);
  const re = /var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/gi;
  if (re.test(v)) {
    v = v.replace(re, (_, ref) => {
      const val = decls.get(ref);
      if (val == null) throw new Error(`token ${key} 引用了未定义的 ${ref}（${theme}）`);
      return val;
    });
    return resolveToken(theme, key, depth + 1);
  }
  if (/^(?:0 1px|0 12px|0 24px|0 0 0 1px)/.test(v)) return null; // 阴影等复合值，不参与颜色计算
  const c = parseColor(v);
  if (!c) throw new Error(`token ${key} 不是可解析颜色：${v}（${theme}）`);
  return c;
}

function tokenColor(theme, name, underName) {
  const c = resolveToken(theme, name);
  if (c.a < 1 && underName) return blend(c, tokenColor(theme, underName));
  if (c.a < 1) return blend(c, tokenColor(theme, 'bg-1'));
  return c;
}

/* ------------------------------- 测试矩阵 ------------------------------- */
const REQ_BODY = 4.5;
const REQ_UI = 3.0;

const TESTS = [];

// 1) 正文 t1/t2/t3 × bg-0..3
for (const fg of ['t1', 't2', 't3']) {
  for (const bg of ['bg-0', 'bg-1', 'bg-2', 'bg-3']) {
    TESTS.push({ cat: '正文', fg, bg, req: REQ_BODY });
  }
}
// 2) 强调文字 × bg-0..2
for (const fg of ['gold', 'gold-2', 'cyan', 'red', 'green', 'amber', 'red-fg', 'green-fg', 'amber-fg']) {
  for (const bg of ['bg-0', 'bg-1', 'bg-2']) {
    TESTS.push({ cat: '强调文字', fg, bg, req: REQ_BODY });
  }
}
// 3) 金色块上的文字
for (const bg of ['gold', 'btn-gold-1', 'btn-gold-2']) {
  TESTS.push({ cat: '金色块', fg: 'on-gold', bg, req: REQ_BODY });
}
// 4) 徽章：彩色文字 × 12% 同色浅底（叠加在卡片 bg-1 上）
for (const [fg, dim] of [
  ['green-fg', 'green-dim'], ['amber-fg', 'amber-dim'], ['red-fg', 'red-dim'],
  ['acq-easy', 'green-dim'], ['acq-craft', 'amber-dim'], ['acq-boss', 'red-dim'],
  ['acq-rng', 'purple-dim'], ['gold-2', 'gold-dim'],
]) {
  TESTS.push({ cat: '徽章', fg, bg: dim, under: 'bg-1', req: REQ_BODY });
}
// 5) 浮层：遮罩 / Toast / 悬浮说明 / 顶栏玻璃 / 选中底
TESTS.push(
  { cat: '浮层', fg: 't1', bg: 'bg-scrim', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't1', bg: 'bg-scrim', under: 'bg-0', req: REQ_BODY },
  { cat: '浮层', fg: 't1', bg: 'toast-bg', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't1', bg: 'tip-bg', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't2', bg: 'tip-bg', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't1', bg: 'glass-1', under: 'bg-0', req: REQ_BODY },
  { cat: '浮层', fg: 't1', bg: 'glass-1', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't2', bg: 'glass-1', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't3', bg: 'glass-1', under: 'bg-1', req: REQ_BODY },
  { cat: '浮层', fg: 't1', bg: 'sel-bg', under: 'bg-1', req: REQ_BODY },
);
// 6) 代码 / 公式块
TESTS.push({ cat: '代码块', fg: 'code-fg', bg: 'bg-0', req: REQ_BODY });
// 7) UI / 大字号：焦点金环、图标
for (const bg of ['bg-0', 'bg-1', 'bg-2']) {
  TESTS.push({ cat: 'UI·焦点环', fg: 'gold', bg, req: REQ_UI });
}
TESTS.push(
  { cat: 'UI·浮层图标', fg: 't3', bg: 'float-1', under: 'bg-1', req: REQ_UI },
  { cat: 'UI·轨道', fg: 'track-1', bg: 'bg-1', req: 1.0, info: '非文本装饰，仅记录' },
);

/* ------------------------------- 计算 ------------------------------- */
const rows = [];
for (const theme of ['dark', 'light']) {
  for (const t of TESTS) {
    let ratio = 0;
    let fgC = null;
    let bgC = null;
    let err = null;
    try {
      bgC = tokenColor(theme, t.bg, t.under);
      let fgC0 = tokenColor(theme, t.fg);
      if (fgC0.a < 1) fgC0 = blend(fgC0, bgC);
      fgC = fgC0;
      ratio = contrast(fgC, bgC);
    } catch (e) {
      err = e.message;
      errors.push(`[${theme}] ${t.fg} × ${t.bg}：${e.message}`);
    }
    const pass = err ? false : ratio >= t.req - 1e-9;
    rows.push({ theme, ...t, ratio, pass, err, fgC, bgC });
  }
}

/* ------------------------------- 一致性检查 ------------------------------- */
const coverageFails = [];
for (const [name, raw] of rootDecls) {
  let c = null;
  try { c = resolveToken('dark', name); } catch { c = null; }
  if (!c) continue; // 非颜色 token
  if (!lightDecls.has(name)) coverageFails.push(name);
}
if (coverageFails.length) errors.push(`亮色主题未覆盖这些颜色 token：${coverageFails.join(', ')}`);

let metaSync = null;
try {
  const themeJs = readFileSync(THEME_JS_PATH, 'utf8');
  // theme-color 必须从 tokens 的唯一色值来源读取，不允许在 JS 里再维护一份十六进制
  const readsToken = /getPropertyValue\(\s*['"]--bg-0['"]\s*\)/.test(themeJs);
  const hardHex = themeJs.match(/(?:#|0x)[0-9a-fA-F]{6}\b/g) || [];
  metaSync = { readsToken, hardHexCount: hardHex.length };
  if (!readsToken) errors.push('theme.js 未从 --bg-0 读取 <meta name="theme-color">（应保持 tokens 唯一色值来源）');
  if (hardHex.length) errors.push(`theme.js 内含硬编码色值：${hardHex.join(', ')}`);
} catch (e) {
  errors.push(`读取 theme.js 失败：${e.message}`);
}

/* ------------------------------- 输出 ------------------------------- */
const padEnd = (s, n) => {
  const w = [...String(s)].reduce((acc, ch) => acc + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(1, n - w));
};

console.log('遗迹2 · 遗物档案 — 双主题对比度报告（来源：css/tokens.css）');
console.log('阈值：正文/强调/徽章/浮层 ≥ 4.5:1；UI/大字号 ≥ 3:1（WCAG 2.x AA）\n');

for (const theme of ['dark', 'light']) {
  const tid = theme;
  const pick = (n) => {
    try { return fmtRGB(tokenColor(tid, n)); } catch { return '?'; }
  };
  console.log(`■ ${THEMES[theme].label}（html[data-theme="${theme}"]）`);
  console.log(`  bg-0 ${pick('bg-0')}  bg-1 ${pick('bg-1')}  bg-2 ${pick('bg-2')}  bg-3 ${pick('bg-3')}`);
  console.log(`  t1 ${pick('t1')}  t2 ${pick('t2')}  t3 ${pick('t3')}`);
  console.log(`  gold ${pick('gold')}  gold-2 ${pick('gold-2')}  on-gold ${pick('on-gold')}  cyan ${pick('cyan')}  red ${pick('red')}  green ${pick('green')}`);
  console.log(`  glass-1 ${pick('glass-1')}  toast ${pick('toast-bg')}  tip ${pick('tip-bg')}  scrim ${pick('bg-scrim')}\n`);
}

console.log(
  padEnd('主题', 5) + padEnd('分类', 10) + padEnd('组合（前景 × 背景）', 40)
  + padEnd('比值', 8) + padEnd('要求', 6) + '结果',
);
console.log('-'.repeat(96));

let lastCat = '';
for (const r of rows) {
  const catKey = `${r.theme}/${r.cat}`;
  if (catKey !== lastCat) {
    lastCat = catKey;
    if (r.cat === TESTS[0].cat && r.theme === 'light') console.log('');
  }
  const combo = `${r.fg} × ${r.bg}${r.under ? ` @${r.under}` : ''}`;
  const verdict = r.err ? 'ERROR' : r.pass ? 'PASS' : 'FAIL';
  const info = r.info ? '（信息）' : '';
  console.log(
    padEnd(THEMES[r.theme].label, 5) + padEnd(r.cat, 10) + padEnd(combo, 40)
    + padEnd(r.ratio.toFixed(2), 8) + padEnd(r.req.toFixed(1), 6) + verdict + info,
  );
  if (r.err) console.log(`      ${r.err}`);
}

const gated = rows.filter((r) => !r.info);
const failed = gated.filter((r) => !r.pass);
const infoRows = rows.filter((r) => r.info);

console.log('\n' + '='.repeat(96));
console.log(`合计 ${gated.length} 项（另有 ${infoRows.length} 项信息性记录）：PASS ${gated.length - failed.length}，FAIL ${failed.length}`);
if (failed.length) {
  console.log('\n失败项：');
  for (const r of failed) {
    console.log(`  - [${THEMES[r.theme].label}] ${r.fg} × ${r.bg}${r.under ? ` @${r.under}` : ''} = ${r.ratio.toFixed(2)}（要求 ≥${r.req}）${r.err ? ' ← ' + r.err : ''}`);
  }
}
if (errors.length) {
  console.log('\n结构 / 一致性错误：');
  for (const e of errors) console.log(`  - ${e}`);
}
const hardFail = failed.length + errors.length;
console.log(hardFail ? `\n✗ 未通过：${hardFail} 项问题` : '\n✓ 全部通过');
process.exit(hardFail ? 1 : 0);
