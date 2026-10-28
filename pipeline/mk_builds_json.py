#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 data/builds.json —— 「流派」视图的唯一数据来源（站点仓库内自包含）。

合并三份上游 build 侧产物，保留原有语义、只做结构归一（不改数值/文案）：

  _source/ui_data.json   7 套配装主体（slots/loop/alts/trash/trinket/armor…）、
                         200 条参与配装的道具 UI 摘要、护甲套装与混搭、规则与口径
  _source/loadouts.json  每套的武器/改装/变异器装配明细（fix_reason、可换槽位、变体）
  _source/builds.json    i18n（仅 wiki 有、本地无 id 的碎片/传奇词条中文效果）、eval_summary

输出 data/builds.json 结构:
  {
    meta, generated_at,
    builds: [ { ...ui_data.builds[k], order, loadout, eval } ],   # 作者顺序
    items: { id: {...} },          # 200 条 UI 摘要（真实 id）
    i18n:  { key: effect_zh },     # 无 id 实体（碎片/传奇/ wiki-only）的中文说明
    archetype_zh, armor, rules, weight_thresholds,
    trinket_principles, trinket_scarcity, underrated, data_notes, eval_notes
  }

用法（在站点仓库根执行）:
  python pipeline/mk_builds_json.py                  # 用 pipeline/_source/ 的源数据
  python pipeline/mk_builds_json.py --check          # 只校验，不写盘
  python pipeline/mk_builds_json.py --source ../../build   # 直接读上游 .mimocode/build/

数据里所有「真实道具 id」都必须能在 data/items.json 里查到；查不到的必须是
纯文本实体（碎片 / 传奇词条 / 固有改装别名），由 i18n 提供中文说明。

源数据由上游解包/配装工具链（.mimocode/build/*.py）产出后放进 _source/；
同步方式见 pipeline/README.md 与 pipeline/sync-data.py。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent          # 站点根
SOURCE = SITE / "pipeline" / "_source"                 # 默认源数据快照
DATA = SITE / "data"

UI_DATA = SOURCE / "ui_data.json"
LOADOUTS = SOURCE / "loadouts.json"
BUILDS = SOURCE / "builds.json"
ITEMS = DATA / "items.json"
OUT = DATA / "builds.json"

# 配装槽位 → 全站槽位族（与 js/core/api.js 的 SLOT_FAMILY 对应）
SLOT_FAMILY = {
    "amulet": "amulet", "ring": "ring", "relic": "relic",
    "long_gun": "longGun", "hand_gun": "handGun", "melee_weapon": "melee",
    "mod": "mod", "meta_gem": "metagem", "perk": "perk", "skill": "skill",
    "trait": "trait", "fragment": "fragment", "legendary": "legendary",
}
# 槽位展示顺序（详情页按此排版）
SLOT_ORDER = [
    "long_gun", "hand_gun", "melee_weapon", "mod", "meta_gem",
    "amulet", "ring", "relic", "trait", "perk", "skill", "fragment", "legendary",
]

def load(path: Path):
    if not path.exists():
        sys.exit(f"[x] 缺少数据文件：{path}")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def raw_items_of(raw_items) -> list[dict]:
    if isinstance(raw_items, dict):
        raw_items = raw_items.get("items") or []
    return [x for x in raw_items if isinstance(x, dict) and x.get("id")]


def item_ids(raw_items) -> set[str]:
    return {str(x.get("id")) for x in raw_items_of(raw_items)}


def build_en_name_index(raw_items) -> dict[str, dict]:
    """英文名 → 道具（用于把固有改装的英文名（如 Beta Ray）解析成 id + 中文名）。"""
    idx: dict[str, dict] = {}
    for x in raw_items_of(raw_items):
        disp = x.get("display") or {}
        en = str(disp.get("name_en") or x.get("label_en") or "").strip()
        if not en:
            continue
        # 同名多命中时优先 cat=mod / action（固有改装都是改装或技能动作）
        prev = idx.get(en)
        if prev is None or (prev.get("cat") not in ("mod", "action") and x.get("cat") in ("mod", "action")):
            idx[en] = x
    return idx


def iter_build_refs(build: dict):
    for slot, ids in (build.get("slots") or {}).items():
        for i in ids or []:
            yield slot, i
    for i in build.get("armor_parts") or []:
        yield "armor", i
    for arch in build.get("archetypes") or []:
        if isinstance(arch, dict) and arch.get("name_en"):
            yield "archetype", arch["name_en"]


def iter_loadout_refs(loadout: dict):
    for w in (loadout.get("weapons") or {}).values():
        for f in ("id", "mutator", "mod", "inherent_mod"):
            if w.get(f):
                yield f, w[f]
    for v in loadout.get("variants") or []:
        if isinstance(v, dict):
            for i in v.get("add") or []:
                yield "variant", i


def enrich_loadout(loadout: dict, en_index: dict[str, dict]) -> dict:
    """固有改装在数据里只有英文名（如 Beta Ray）——补一份 id + 中文名，不改原字段。"""
    out = json.loads(json.dumps(loadout, ensure_ascii=False))
    for w in (out.get("weapons") or {}).values():
        raw_name = str(w.get("inherent_mod") or "").strip()
        if not raw_name:
            continue
        hit = en_index.get(raw_name)
        w["inherent_mod_item"] = (
            {"id": hit.get("id"), "name_zh": (hit.get("display") or {}).get("name_zh") or hit.get("zh_name") or "",
             "name_en": raw_name}
            if hit else None
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写盘")
    ap.add_argument("--source", default=None,
                    help="源数据目录（含 ui_data.json / loadouts.json / builds.json；默认 pipeline/_source）")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()
    if args.source:
        global UI_DATA, LOADOUTS, BUILDS
        src_dir = Path(args.source).resolve()
        UI_DATA = src_dir / "ui_data.json"
        LOADOUTS = src_dir / "loadouts.json"
        BUILDS = src_dir / "builds.json"
    log = (lambda *a: None) if args.quiet else print

    ui = load(UI_DATA)
    loads = load(LOADOUTS)
    src = load(BUILDS)
    raw_items = load(ITEMS)
    known_ids = item_ids(raw_items)
    en_index = build_en_name_index(raw_items)

    ui_builds = ui.get("builds") or {}
    if not isinstance(ui_builds, dict) or len(ui_builds) < 1:
        sys.exit("[x] ui_data.builds 结构不符合预期")

    loadout_by_key = loads.get("builds") or {}
    eval_by_key = {e.get("key"): e for e in (ui.get("eval_summary") or []) if e.get("key")}
    i18n = src.get("i18n") or {}
    archetype_zh = ui.get("archetype_zh") or {}

    # ---- 排序：作者顺序 = ui_data.builds 的字典顺序（index 01→07 与之一致）----
    order_keys = list(ui_builds.keys())

    # ---- 一致性校验：ui_data.loadouts 与 loadouts.json 必须同源 ----
    warn = []
    ui_load = ui.get("loadouts") or {}
    for k in order_keys:
        a = json.dumps(ui_load.get(k), sort_keys=True, ensure_ascii=False)
        b = json.dumps(loadout_by_key.get(k), sort_keys=True, ensure_ascii=False)
        if a != b:
            warn.append(f"loadouts 不一致：{k}")

    builds = []
    unresolved: list[tuple[str, str, str]] = []
    for idx, key in enumerate(order_keys, 1):
        raw = ui_builds[key]
        slots = raw.get("slots") or {}
        # 槽位归一：补 family、按固定顺序输出；空槽保留（不删语义）
        slots_norm = {}
        for slot in SLOT_ORDER:
            if slot in slots:
                slots_norm[slot] = list(slots[slot])
        for slot in slots:  # 未知槽位原样保留在末尾，不丢弃
            if slot not in slots_norm:
                slots_norm[slot] = list(slots[slot])

        build = {
            "key": key,
            "order": idx,
            "name_zh": raw.get("name_zh") or key,
            "tagline": raw.get("tagline") or "",
            "role": raw.get("role") or "",
            "chain_zh": raw.get("chain_zh") or "",
            "ratings": raw.get("ratings") or {},
            "scenario": raw.get("scenario") or "",
            "archetypes": raw.get("archetypes") or [],
            "armor": raw.get("armor") or {},
            "armor_parts": list(raw.get("armor_parts") or []),
            "slots": slots_norm,
            "slot_order": [s for s in SLOT_ORDER if s in slots_norm],
            "loop": raw.get("loop") or [],
            "alts": raw.get("alts") or [],
            "evidence": raw.get("evidence") or [],
            "trash_plan": raw.get("trash_plan") or [],
            "trash_fix": raw.get("trash_fix") or [],
            "difficulty_notes": raw.get("difficulty_notes") or [],
            "trinket": raw.get("trinket") or {},
            "loadout": enrich_loadout(loadout_by_key.get(key) or {}, en_index),
            "eval": eval_by_key.get(key) or {},
        }
        # 引用解析：真实 id / 纯文本实体
        for slot, ref in iter_build_refs(build):
            if ref in known_ids:
                continue
            if ref in i18n or ref in archetype_zh:
                continue
            unresolved.append((key, slot, ref))
        for slot, ref in iter_loadout_refs(build["loadout"]):
            if ref in known_ids or ref in i18n:
                continue
            unresolved.append((key, slot, ref))
        builds.append(build)

    items = ui.get("items") or {}
    missing_ui = [k for k in known_ids if k not in items]  # 信息性：UI 摘要只覆盖参与配装的道具
    stale_ui = [k for k in items if k not in known_ids]

    out = {
        "meta": {
            **(ui.get("meta") or {}),
            "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
            "source": "data/items.json · pipeline/_source/{ui_data,loadouts,builds}.json",
            "generator": "pipeline/mk_builds_json.py",
            "counts": {
                "builds": len(builds),
                "items": len(items),
                "i18n": len(i18n),
                "rules": len(ui.get("rules") or []),
                "armor_sets": len((ui.get("armor") or {}).get("sets") or []),
            },
            "schema": 1,
        },
        "builds": builds,
        "items": items,
        "i18n": i18n,
        "archetype_zh": archetype_zh,
        "armor": ui.get("armor") or {},
        "rules": ui.get("rules") or [],
        "weight_thresholds": ui.get("weight_thresholds") or {},
        "trinket_principles": ui.get("trinket_principles") or [],
        "trinket_scarcity": ui.get("trinket_scarcity") or {},
        "underrated": ui.get("underrated") or [],
        "data_notes": ui.get("data_notes") or [],
        "eval_notes": ui.get("eval_notes") or [],
    }

    log(f"[i] 配装 {len(builds)} 套：{'、'.join(b['name_zh'] for b in builds)}")
    log(f"[i] UI 道具摘要 {len(items)} 条；items.json 真实 id {len(known_ids)} 条")
    log(f"[i] i18n 纯文本实体 {len(i18n)} 条；护甲套装 {(ui.get('armor') or {}).get('sets').__len__() if (ui.get('armor') or {}).get('sets') else 0} 套")
    if warn:
        for w in warn:
            log(f"[!] {w}")
    if unresolved:
        log(f"[!] {len(unresolved)} 个引用既不在 items.json 也不在 i18n：")
        for key, slot, ref in unresolved[:20]:
            log(f"    {key} / {slot} → {ref}")
    else:
        log("[✓] 所有配装引用都能解析（真实 id 或 i18n 文本实体）")
    if stale_ui:
        log(f"[i] UI 摘要里有 {len(stale_ui)} 条 id 不在 items.json（历史残留，视图会自动回退）: {stale_ui[:5]}")
    _ = missing_ui  # 仅信息性，不打印（171 条参与配装 id 中多数在 UI 摘要内）

    if args.check:
        log("[i] --check：不写盘")
        return 0
    DATA.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    log(f"[✓] 写出 {OUT.relative_to(SITE)}  ({OUT.stat().st_size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
