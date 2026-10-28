#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""遗迹2 · 遗物档案 —— 静态审计（零依赖，可单独跑）

覆盖 docs/UX_SPEC.md §7 术语、§8 视觉 token、§3 组件、§10 验收：
  A. 硬编码 HEX 颜色（css/view-*.css、js/views/** 为 FAIL；js/lab|components|core 为 WARN）
  B. 用户可见文案里的裸英文（白名单可配：道具英文名/字段/id/技术缩写）
  C. 重复标题（同一视图多个 h1；同视图重复 panel 标题）
  D. 可访问性（button 无文本且无 aria-label；img 无 alt；div[role=button] 无 tabindex）
  E. 禁用词 / 术语不一致（护甲强度/减伤值/负载/元宝石/Buff/DPS…）
  F. 外部网络 / CDN（纯静态离线约束）

用法：python qa/audit.py [--root .] [--json qa/results/audit-baseline.json]
退出码：0 无 FAIL；1 有 FAIL；2 参数/路径错误
可单独跑，不依赖浏览器；输出带 file:line 证据。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

CJK = re.compile(r'[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]')
HEX = re.compile(r'#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])')
RGBA = re.compile(r'\brgba?\(\s*\d')
STR_LIT = re.compile(r"""(?<![\\\w])(?:'((?:[^'\\\n]|\\.){1,240})'|"((?:[^"\\\n]|\\.){1,240})"|`((?:[^`\\\n]|\\.){1,240})`)""")
EXT_URL = re.compile(r'(?:https?:)?//(?!127\.0\.0\.1|localhost)[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}', re.I)
SVG_PATH = re.compile(r'^[Mm][\d\s.,\-]+[LlHhVvCcSsQqTtAaZz]?')
IDENT = re.compile(r'^[A-Za-z_$][\w$.\-/:@]*$')
CSS_SEL = re.compile(r'^[.#][a-zA-Z][\w-]*(?:\s*[\w-]*)?(?:\s*[.#:>\s][\w\-:.\s>+~,]*)?$')
CSS_VAR = re.compile(r'^(?:--[\w-]+)(?:\s*,\s*--?[\w-]+)*$')
CSS_DECL = re.compile(r'^[-a-z]+\s*:\s*[^;]+(?:;\s*[-a-z]+\s*:\s*[^;]+)*;?$')
MATH_LIKE = re.compile(r'[=×Σ→≈≤≥√]|^[A-Z][A-Z0-9_]{2,}\s*[=(]|ARMOR_DR|TOTAL_i|EFF_i|min\(|max\(')
UI_CONTEXT = re.compile(r"""(?:text\s*:|textContent|aria-label|ariaLabel|title\s*:|label\s*:|placeholder|alt\s*:|toast\(|confirm\(|openModal\(|openDrawer\(|hint\s*:|kicker|attrs\s*:\s*\{[^}]*title|body\s*:\s*['"`])""")
CLASSES = re.compile(r'^(?:[a-z][\w-]*)(?:\s+[a-z][\w-]*)+$')
FILENAME = re.compile(r'\.(?:js|mjs|css|json|png|jpe?g|svg|html|md|py|ico|webp)$', re.I)
H1_CALL = re.compile(r"""\bh\(\s*['"]h1['"]""")
H2_CALL = re.compile(r"""\bh\(\s*['"]h2['"]""")
BUTTON_CALL = re.compile(r"""\bh\(\s*['"]button['"]""")
IMG_CALL = re.compile(r"""\bh\(\s*['"]img['"]""")
ROLE_BUTTON = re.compile(r"""role\s*:\s*['"]button['"]""")
PANEL_TITLE = re.compile(r"""panel__title['"]?\s*[,}]?\s*(?:attrs\s*:\s*\{[^}]*\})?\s*,?\s*text\s*:\s*['"]([^'"]{1,40})['"]""")

SCAN_TEXT_GLOBS = [
    'js/views/*.js', 'js/lab/*.js', 'js/components/*.js',
    'js/main.js', 'index.html',
]
SCAN_HEX_FAIL = ['css/view-*.css', 'js/views/*.js']
# 设计系统层（tokens.css / components.css / base.css）与 lab|components|core 的 js：
# 按 Lead 2026-10-27 裁决豁免，只统计为 INFO，不计入 FAIL/WARN 噪声。
SCAN_HEX_INFO = ['css/base.css', 'css/components.css', 'css/components-picker.css',
                 'js/lab/*.js', 'js/components/*.js', 'js/core/*.js']
SCAN_A11Y = ['js/views/*.js', 'js/lab/*.js', 'js/components/*.js', 'index.html']
SCAN_TERMS = SCAN_TEXT_GLOBS + ['js/core/*.js', 'data/codex/*.json', 'data/codex/**/*.json']
SCAN_EXT = ['index.html', 'css/*.css', 'js/**/*.js']

DEFAULT_WHITELIST = {
    "_说明": "裸英文白名单：单 token 技术缩写 / 允许出现的英文名；命中则不报。banned_terms 可按项目追加。",
    "latin_allow": [
        "OK", "URL", "API", "JSON", "SVG", "PNG", "CSS", "JS", "HTML", "AI", "ID", "UI", "UX",
        "HP", "DR", "DPS_FREE_PLACEHOLDER", "REMNANT", "II", "NONE", "NULL", "TRUE", "FALSE",
        "R2", "Alt", "Esc", "Ctrl", "Shift", "Tab", "Enter",
    ],
    "latin_allow_patterns": [
        "^[A-Za-z]$",                      # 单字母
        "^[0-9.]+\\s?[A-Za-z%]+$",         # 12px / 90%
        "^[A-Za-z0-9]+(?:[_./-][A-Za-z0-9]+)*$",  # 纯标识/文件名（不含空格，避免把英文句子当标识）
    ],
    "english_ui_verbs": [
        "Loading", "Save", "Delete", "Close", "Search", "Done", "Reset", "Apply",
        "Cancel", "Remove", "Edit", "Add", "Open", "View", "Filter", "Sort", "Share",
        "Export", "Import", "Confirm", "Submit", "Continue", "Back", "Next", "Previous",
        "Copy", "Copied", "Error", "Warning", "Success", "Failed", "Empty", "No",
        "Show", "Hide", "More", "Less", "All", "Total", "Items", "Builds",
    ],
    "banned_terms": [
        "护甲强度", "减伤值", "负载", "元宝石", "Buff", "DPS",
    ],
    "banned_except_context": {
        "DPS": ["data/codex/"],
        "*": ["js/core/labels.js"]
    },
}

AREA = {
    'A': '硬编码颜色',
    'B': '裸英文文案',
    'C': '重复标题',
    'D': '可访问性',
    'E': '术语/禁用词',
    'F': '外部依赖',
}


class Collect:
    def __init__(self):
        self.items = []

    def add(self, area, severity, title, file, line=None, snippet='', note=''):
        self.items.append({
            'area': area, 'area_zh': AREA.get(area, area), 'severity': severity,
            'title': title, 'file': file, 'line': line,
            'snippet': (snippet or '').strip()[:200], 'note': note,
        })


def rel(p: Path, root: Path) -> str:
    try:
        return str(p.relative_to(root)).replace('\\', '/')
    except ValueError:
        return str(p)


def expand(root: Path, globs):
    out = []
    for g in globs:
        out.extend(sorted(root.glob(g)))
    seen, uniq = set(), []
    for p in out:
        if p.is_file() and p not in seen and '/qa/' not in str(p).replace('\\', '/'):
            seen.add(p)
            uniq.append(p)
    return uniq


def load_wl(root: Path) -> dict:
    wl_path = root / 'qa' / 'whitelist.json'
    if wl_path.exists():
        try:
            data = json.loads(wl_path.read_text(encoding='utf-8'))
            merged = dict(DEFAULT_WHITELIST)
            merged.update({k: v for k, v in data.items() if not k.startswith('_')})
            # 字典类键做并集，保证默认豁免不被旧 whitelist.json 覆盖掉
            for k in ('banned_except_context',):
                base = dict(DEFAULT_WHITELIST.get(k) or {})
                base.update(data.get(k) or {})
                merged[k] = base
            if 'latin_allow' in data and isinstance(data['latin_allow'], list):
                merged['latin_allow'] = list(dict.fromkeys(
                    list(DEFAULT_WHITELIST.get('latin_allow') or []) + data['latin_allow']))
            return merged
        except Exception as e:  # noqa: BLE001
            print(f'[audit][warn] whitelist.json 解析失败，使用默认：{e}')
    else:
        wl_path.parent.mkdir(parents=True, exist_ok=True)
        wl_path.write_text(json.dumps(DEFAULT_WHITELIST, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'[audit] 已生成白名单 {rel(wl_path, root)}（可追加 latin_allow / banned_terms）')
    return DEFAULT_WHITELIST


def read_lines(p: Path):
    try:
        return p.read_text(encoding='utf-8', errors='replace').splitlines()
    except Exception:  # noqa: BLE001
        return []


# --------------------------- A. 硬编码颜色 ---------------------------
def check_hex(root: Path, c: Collect):
    for level, globs in (('FAIL', SCAN_HEX_FAIL), ('INFO', SCAN_HEX_INFO)):
        for f in expand(root, globs):
            rp = rel(f, root)
            if rp.endswith('css/tokens.css'):
                continue
            for i, line in enumerate(read_lines(f), 1):
                if line.strip().startswith(('//', '/*', '*', '<!--')):
                    continue
                for m in HEX.finditer(line):
                    c.add('A', level, f'孤立色值 {m.group(0)}（应改用 tokens 变量）', rp, i,
                          line.strip(), '颜色必须来自 css/tokens.css 的 CSS 变量')
                if level == 'FAIL':
                    for m in RGBA.finditer(line):
                        c.add('A', 'WARN', f'硬编码 rgb/rgba {m.group(0)}…', rp, i,
                              line.strip(), '视图层建议改用 tokens 变量/tokens alpha')


# --------------------------- B. 裸英文文案 ---------------------------
def classify_literal(t: str, wl: dict) -> str:
    """返回 'safe' | 'warn' | 'flag'。safe=不可能是用户可见英文；warn=公式/标识符样式。"""
    t = t.strip()
    if not t:
        return 'safe'
    if CJK.search(t):
        return 'safe'
    if not re.search(r'[A-Za-z]', t):
        return 'safe'
    if HEX.search(t) and len(t) < 30 and ' ' not in t:
        return 'safe'
    if (t.startswith(('.', '#', '--')) and CSS_SEL.match(t)) or CSS_VAR.match(t):
        return 'safe'
    if IDENT.match(t):
        return 'safe'
    if CSS_DECL.match(t):
        return 'safe'
    if 'max-width' in t or 'min-width' in t or re.match(r'^\([^)]*\)$', t):
        return 'safe'
    if CLASSES.match(t) and all(re.match(r'^[a-z][\w-]*$', tok) for tok in t.split()):
        return 'safe'
    if FILENAME.search(t):
        return 'safe'
    if SVG_PATH.match(t):
        return 'safe'
    if re.match(r'^(?:https?:|/|\./|\.\./|#|data:|mailto:|ws:)', t):
        return 'safe'
    if re.match(r'^[A-Za-z0-9+/=]{16,}$', t):
        return 'safe'
    if re.match(r'^[\d\s.,:%+\-/×xX()\[\]]+$', t):
        return 'safe'
    allow = {x.lower() for x in wl.get('latin_allow', [])}
    if t.lower() in allow:
        return 'safe'
    for pat in wl.get('latin_allow_patterns', []):
        try:
            if re.match(pat, t):
                return 'safe'
        except re.error:
            pass
    if MATH_LIKE.search(t):
        return 'warn'                              # 公式/算法块：允许但建议配中文说明
    # 只有「纯字母/空格/连字符/撇号」才可能是英文文案；含 : , = 等一律视作代码片段
    if not re.match(r"^[A-Za-z][A-Za-z0-9 '’\-]*$", t):
        return 'safe'
    return 'flag'


def check_english(root: Path, c: Collect, wl: dict):
    verbs = {x.lower() for x in wl.get('english_ui_verbs', [])}
    for f in expand(root, SCAN_TEXT_GLOBS):
        rp = rel(f, root)
        is_html = f.suffix == '.html'
        for i, line in enumerate(read_lines(f), 1):
            s2 = line.strip()
            if s2.startswith(('//', '/*', '*', '<!--')) or 'console.' in line:
                continue
            if is_html:
                text = re.sub(r'<script[^>]*>.*?</script>', ' ', line)
                text = re.sub(r'<[^>]+>', ' ', text)
                if CJK.search(text):
                    continue
                if len(re.findall(r'[A-Za-z]{2,}', text)) >= 2:
                    c.add('B', 'FAIL', f'裸英文文案：「{text.strip()[:60]}」', rp, i, s2,
                          '用户可见文案须简体中文')
                # 可见属性（title/aria-label/alt/placeholder）也检查
                for m in re.finditer(r'(title|aria-label|alt|placeholder)="([^"]+)"', line):
                    val = m.group(2)
                    if classify_literal(val, wl) == 'flag' and re.search(r'[A-Za-z]{2,}', val):
                        c.add('B', 'FAIL', f'{m.group(1)} 属性裸英文：「{val[:60]}」', rp, i, s2,
                              '可访问名称/可见属性须简体中文')
                continue
            for m in STR_LIT.finditer(line):
                val = next((g for g in m.groups() if g is not None), '')
                if '${' in val or '\n' in val or len(val) > 200:
                    continue
                kind = classify_literal(val, wl)
                if kind == 'safe':
                    continue
                # 仅当处于 UI 文案上下文（text:/title:/aria-label/toast 等）才判定用户可见
                ctx = line[max(0, m.start() - 140):m.end() + 40]
                if kind == 'warn':
                    if UI_CONTEXT.search(ctx):
                        c.add('B', 'WARN', f'公式/标识符出现在文案位：「{val.strip()[:60]}」',
                              rp, i, s2, '若属证据/公式折叠区可接受；否则建议中文化说明')
                    continue
                if not UI_CONTEXT.search(ctx):
                    continue
                words = re.findall(r'[A-Za-z]{2,}', val)
                if len(words) >= 2 or (len(words) == 1 and words[0].lower() in verbs):
                    c.add('B', 'FAIL', f'裸英文文案：「{val.strip()[:60]}」', rp, i, s2,
                          '用户可见文案须简体中文（英文仅允许道具英文名副标题/证据折叠区）')


# --------------------------- C. 重复标题 ---------------------------
def check_headings(root: Path, c: Collect):
    for f in expand(root, ['js/views/*.js', 'js/lab/*.js', 'index.html']):
        rp = rel(f, root)
        lines = read_lines(f)
        text = '\n'.join(lines)
        h1n = len(H1_CALL.findall(text)) + len(re.findall(r'<h1[ >]', text))
        if h1n > 1:
            # 视图可能按子路由渲染不同 h1（目录页/条目页），静态只能提示，真实判定见 interactions.js
            c.add('C', 'WARN', f'同一视图文件出现 {h1n} 个 h1 调用（需动态确认是否同屏）', rp, None, '',
                  '每页只允许 1 个 h1；若为不同子路由互斥渲染则可通过')
        # 同文件重复 panel 标题
        titles = {}
        for i, line in enumerate(lines, 1):
            for m in PANEL_TITLE.finditer(line):
                t = m.group(1).strip()
                titles.setdefault(t, []).append(i)
            m2 = re.search(r"""text\s*:\s*['"]([^'"]{2,30})['"]""", line)
            if m2 and ('panel__title' in line or 'h2' in line):
                titles.setdefault(m2.group(1).strip(), []).append(i)
        for t, ln in titles.items():
            if len(ln) > 1 and len(t) >= 2:
                c.add('C', 'WARN', f'同一文件重复标题「{t}」×{len(ln)}', rp, ln[1], '',
                      '同一上下文同一信息只出现一次')
    # 动态检查（h1/h2 去重）由 interactions.js 在真实 DOM 上做


# --------------------------- D. 可访问性 ---------------------------
def _window_after(lines, i, n=12):
    return '\n'.join(lines[i - 1:i - 1 + n])


def check_a11y(root: Path, c: Collect):
    for f in expand(root, SCAN_A11Y):
        rp = rel(f, root)
        lines = read_lines(f)
        for i, line in enumerate(lines, 1):
            if BUTTON_CALL.search(line):
                same = line
                closed_same_line = ('})' in same or same.rstrip().endswith('})')
                                    or same.rstrip().endswith('})),'))
                has_inline = ('icon(' in same or "text:" in same.replace(' ', '')
                              or 'aria-label' in same or 'ariaLabel' in same)
                if closed_same_line and not has_inline:
                    c.add('D', 'FAIL', 'button 单行构造且无文本/aria-label', rp, i, line.strip(),
                          '按钮必须有可读名称（文本或 aria-label）；图标按钮见 §3')
                elif not has_inline:
                    c.add('D', 'INFO', 'button 跨行构造（静态不可判定，由动态 G7 判定）', rp, i, line.strip(),
                          '动态检查见 interactions.js G7')
            if IMG_CALL.search(line) or re.search(r'<img\b', line):
                win = _window_after(lines, i, 6)
                if 'alt' not in win:
                    c.add('D', 'FAIL', 'img 缺 alt', rp, i, line.strip(), '图片必须有 alt（装饰图 alt=""）')
            if ROLE_BUTTON.search(line):
                win = _window_after(lines, i, 10)
                if 'tabindex' not in win and 'tabIndex' not in win:
                    c.add('D', 'FAIL', 'div[role=button] 缺 tabindex', rp, i, line.strip(),
                          '键盘不可达；应改用 button 或补 tabindex="0" + 键处理')


# --------------------------- E. 术语/禁用词 ---------------------------
def check_terms(root: Path, c: Collect, wl: dict):
    banned = wl.get('banned_terms', [])
    except_map = wl.get('banned_except_context', {})
    for f in expand(root, SCAN_TERMS):
        rp = rel(f, root)
        for i, line in enumerate(read_lines(f), 1):
            for term in banned:
                if term not in line:
                    continue
                # 拉丁词（Buff/DPS）要求词边界，避免命中 accBuff 之类标识符
                if re.match(r'^[A-Za-z]', term):
                    if not re.search(r'(?<![A-Za-z])' + re.escape(term) + r'(?![A-Za-z])', line):
                        continue
                ctx = list(except_map.get(term) or []) + list(except_map.get('*') or [])
                # core/labels.js 是「英文→中文」词典本身，命中禁用词属预期
                if rp == 'js/core/labels.js':
                    continue
                if any(rp.startswith(x) for x in ctx):
                    continue
                # 注释行降级为 WARN（用户不可见）
                sev = 'WARN' if line.strip().startswith(('//', '/*', '*', '#')) else 'FAIL'
                c.add('E', sev, f'禁用词「{term}」', rp, i, line.strip(),
                      '按 UX_SPEC §7 使用权威中文术语')


# --------------------------- F. 外部依赖 ---------------------------
def check_external(root: Path, c: Collect):
    for f in expand(root, SCAN_EXT):
        rp = rel(f, root)
        if '/qa/' in rp:
            continue
        for i, line in enumerate(read_lines(f), 1):
            s = line.strip()
            if s.startswith(('//', '/*', '*', '<!--')):
                continue
            for m in EXT_URL.finditer(line):
                host = m.group(0).lower()
                if 'w3.org/2000/svg' in host or '/2000/svg' in line:
                    continue                       # SVG 命名空间常量，不是网络请求
                c.add('F', 'FAIL', f'外部地址 {m.group(0)}', rp, i, line.strip(),
                      '必须纯离线：无 CDN、无外部字体、无联网请求')


# --------------------------- 汇总输出 ---------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(
        description='遗迹2 站点静态审计（零依赖）：硬编码色值 / 裸英文 / 重复标题 / a11y / 禁用词 / 外链',
        epilog='退出码：0=无 FAIL；1=存在 FAIL；2=路径错误。'
               '一条命令跑完全部验收：node qa/shot.js --all && '
               'node qa/interactions.js && python qa/audit.py')
    ap.add_argument('--root', default=None, help='站点根目录（默认按脚本位置推断）')
    ap.add_argument('--json', default=None, help='结果 JSON 路径')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args(argv)

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[1]
    # 脚本位于 <root>/qa/audit.py → parents[1] = <站点根>
    if not (root / 'index.html').is_file():
        print(f'[audit] 找不到 index.html：{root}', file=sys.stderr)
        return 2
    wl = load_wl(root)
    c = Collect()
    check_hex(root, c)
    check_english(root, c, wl)
    check_headings(root, c)
    check_a11y(root, c)
    check_terms(root, c, wl)
    check_external(root, c)

    fails = [i for i in c.items if i['severity'] == 'FAIL']
    warns = [i for i in c.items if i['severity'] == 'WARN']
    infos = [i for i in c.items if i['severity'] == 'INFO']
    by_area = {}
    for it in c.items:
        a = it['area']
        by_area.setdefault(a, {'FAIL': 0, 'WARN': 0, 'INFO': 0})[it['severity']] += 1

    if not args.quiet:
        print('=' * 78)
        print('遗迹2 站点 · 静态审计（UX_SPEC §3/§7/§8/§10）')
        print('=' * 78)
        for a in sorted(by_area):
            d = by_area[a]
            print(f'  {a}. {AREA.get(a, a):12s}  FAIL={d["FAIL"]:3d}  WARN={d["WARN"]:3d}  INFO={d["INFO"]:3d}')
        print('-' * 78)
        shown = 0
        for sev in ('FAIL', 'WARN'):
            group = [i for i in c.items if i['severity'] == sev]
            for it in group[:60]:
                loc = f"{it['file']}:{it['line']}" if it['line'] else it['file']
                print(f"[{sev}] {it['title']}")
                print(f"       {loc}")
                if it['snippet']:
                    print(f"       │ {it['snippet'][:150]}")
                shown += 1
            if len(group) > 60:
                print(f'  … 另有 {len(group) - 60} 条 {sev} 未显示（见 JSON）')
        print('-' * 78)
        print(f'结论：FAIL={len(fails)}  WARN={len(warns)}  INFO={len(infos)}  '
              f'→ {"PASS" if not fails else "FAIL"}')
        print('注：css/tokens.css｜components.css｜base.css 属设计系统层，已按裁决豁免（仅 INFO）。')
        print('=' * 78)

    out_path = Path(args.json) if args.json else (root / 'qa' / 'results' / 'audit.json')
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        'generated_at': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'root': str(root),
        'summary': {'fail': len(fails), 'warn': len(warns), 'info': len(infos),
                    'by_area': by_area, 'pass': not fails},
        'items': c.items,
    }, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
    if not args.quiet:
        print(f'[audit] → {out_path}')
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
