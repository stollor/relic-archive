/* =============================================================================
   遗迹2 · 遗物档案 — lab/text.js
   实验室专用中文文案：效果转写、条件说明、获取难度徽章映射。
   术语严格按 UX_SPEC §7（护甲值 / 减伤率 / 护甲效果 / 负重 / 负重档位 / 体力 / 闪避 / 壁垒）。
   ========================================================================== */
import { TYPE_ZH, CLASS_ZH } from './engine.js';

const RES_ZH = { bleed: '流血', fire: '火焰', shock: '电击', corrosive: '腐蚀', blight: '枯萎', all: '全' };
const f0 = (v) => String(Math.round(v * 100));
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** 归一化 effect → 中文短语数组 */
export function effectList(eff) {
  if (!eff) return [];
  const out = [];
  for (const [k, v] of Object.entries(eff)) {
    if (k === 'bulwark' && v === true) continue;
    switch (k) {
      case 'armor_efficacy': out.push(`护甲效果 ${v > 0 ? '+' : ''}${f0(v)}%`); break;
      case 'armor_flat': out.push(`护甲值 ${v > 0 ? '+' : ''}${f1(v)}`); break;
      case 'weight_flat': out.push(`负重 ${v > 0 ? '+' : ''}${f1(v)}`); break;
      case 'weight_pct': out.push(`负重 ${v > 0 ? '+' : ''}${f0(v)}%`); break;
      case 'weight_threshold_flat': out.push(`闪避负重阈值 ${v > 0 ? '+' : ''}${f1(v)}`); break;
      case 'resistance_flat':
        for (const [rk, rv] of Object.entries(v || {})) {
          out.push(`${RES_ZH[rk] || rk}${rk === 'all' ? '抗性' : '抗性'} ${rv > 0 ? '+' : ''}${f1(rv)}`);
        }
        break;
      case 'resistance_pct':
        for (const [rk, rv] of Object.entries(v || {})) out.push(`${RES_ZH[rk] || rk}抗性 ${rv > 0 ? '+' : ''}${f0(rv)}%`);
        break;
      case 'flat_dr': out.push(`固定减伤 ${v > 0 ? '+' : ''}${f1(v * 100)}%`); break;
      case 'enemy_damage_reduction': out.push(`敌人伤害 -${f1(v * 100)}%`); break;
      case 'elemental_dr': out.push(`元素减伤 ${v > 0 ? '+' : ''}${f0(v)}%（火焰 / 电击 / 腐蚀）`); break;
      case 'stamina_max': out.push(`体力上限 ${v > 0 ? '+' : ''}${f0(v)}`); break;
      case 'stamina_pct': out.push(`体力上限 ${v > 0 ? '+' : ''}${f0(v)}%`); break;
      case 'stamina_regen': out.push(`体力回复 +${f1(v)}/s`); break;
      case 'stamina_cost_pct': out.push(`闪避体力消耗 ${v > 0 ? '+' : ''}${f0(v)}%`); break;
      case 'stamina_regen_delay_pct': out.push(`体力回复延迟 ${f0(v)}%`); break;
      case 'evade_window_pct': out.push(`闪避无敌时间 +${f0(v)}%`); break;
      case 'evade_distance_pct': out.push(`闪避距离 +${f0(v)}%`); break;
      case 'evade_speed_pct': out.push(`闪避速度 +${f0(v)}%`); break;
      case 'health_max': out.push(`生命 ${v > 0 ? '+' : ''}${f1(v)}`); break;
      case 'health_pct': out.push(`生命 +${f0(v)}%`); break;
      case 'shield_pct': out.push(`护盾 +${f0(v)}%`); break;
      case 'health_regen': out.push(`生命回复 +${f1(v)}/s`); break;
      default: break;
    }
  }
  return out;
}

export function effectText(eff) { return effectList(eff).join('，'); }

const COND_ZH = {
  always: '常驻', while_shield: '护盾期间', while_shield_active: '护盾期间',
  on_perfect_dodge: '完美闪避后', after_perfect_dodge: '完美闪避后', on_melee_hit: '近战命中后',
  while_skill_active: '技能激活期间', while_mod_active: '改装激活期间', while_heavy_weapon: '持重武器时',
  while_summons_active: '召唤物存在时', while_low_health: '低生命期间', while_missing_health: '缺生命期间',
  while_grey_health: '灰血期间', while_debuffed: '负面状态期间', while_sprinting: '冲刺期间',
  while_melee_attacking: '近战攻击期间', while_near_bleeding: '附近流血时', while_spending_stamina: '消耗体力时',
  after_damage_taken: '受伤后', after_direct_damage: '受直伤后', after_elemental_damage: '受元素伤后',
  after_big_hit: '受重击后', after_relic_use: '使用圣物后', after_slide: '滑铲后',
  after_charged_shot: '蓄力射击后', after_mag_dump: '弹匣清空后', after_10s_undamaged: '10 秒未受伤后',
  while_invuln_cooldown: '无敌冷却期间', while_drone_active: '无人机激活期间',
  while_consumable_active: '消耗品生效期间', while_curative_applied: '治疗生效期间', on_pickup: '拾取时',
  bulwark_stacks: '按壁垒层数', health_low: '低生命期间', low_health: '低生命期间',
  melee: '仅近战伤害', while_bulwark: '有壁垒层数时',
};

export function condText(m) {
  if (!m || !m.condition) return '';
  const zh = COND_ZH[m.condition] || '条件触发';
  const up = m.uptime == null ? 1 : m.uptime;
  return `条件：${zh}（覆盖率 ${Math.round(up * 100)}%）`;
}

export function condShort(m) {
  if (!m || !m.condition) return '';
  return COND_ZH[m.condition] || '条件触发';
}

export { TYPE_ZH, CLASS_ZH, RES_ZH };
