/**
 * qa/lib/schema.mjs — 通用数据契约校验器（零依赖，Node 26 ESM）。
 *
 * 设计目标：
 *   1) 规则是**纯数据**（可复用、可单测、可缓存）；校验器本身不 import 任何仓库代码。
 *   2) 错误可定位：每条诊断都带「文件 + RFC6901 JSON Pointer + 期望 + 实际」。
 *   3) 默认宽松：未知字段一律忽略（不报错）；必填字段必须写明 why（为什么必须有），
 *      错误信息会带上该原因，避免「校验器说缺就缺、没人知道为什么」。
 *
 * 用法：
 *   import { validate, formatDiagnostic } from './schema.mjs';
 *   const { errors, warnings } = validate(doc, rule, { file: 'data/items.json' });
 *
 * 规则字段（全部可选）：
 *   type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'any'
 *         或上述的数组（多选一，如 ['string', 'null']）
 *   nullable: true           允许 null，直接通过（等价于把 'null' 放进 type）
 *   required: [{key, why}]   对象必填字段；why 说明为什么不能少
 *   properties: {key: rule}  只在字段存在（!== undefined）时校验
 *   additionalProperties: rule  针对未在 properties 中声明的字段
 *   propertyNames: {enum, pattern}  校验对象的键名
 *   items: rule              数组元素规则
 *   minItems / maxItems: number
 *   uniqueBy: 'key' | (item) => any   数组内唯一；重复项报在靠后一项上
 *   enum: any[]              允许值（=== 比较）
 *   const: any               必须等于该值（数组/对象做深比较）
 *   minLength / maxLength: number     字符串长度
 *   pattern: RegExp | string 字符串正则
 *   minimum / maximum: number         数值范围
 *   checks: [(value, ctx) => void]    自定义检查；ctx.fail(tokens, info) / ctx.warn(tokens, info)
 *
 * 诊断结构：{ file, pointer, expected, actual, message }
 *   pointer：RFC6901 编码（'~'→'~0'，'/'→'~1'），根为 ''。
 *   expected：人可读的期望描述；actual：原始实际值（打印用 describeValue）。
 */

/** @typedef {{ file: string, pointer: string, expected: string, actual: any, message: string }} Diagnostic */

const MAX_ACTUAL = 160;

/** 打印实际值：截断、去换行，undefined 特殊显示 */
export function describeValue(value) {
  if (value === undefined) return 'undefined（缺失）';
  let text;
  if (typeof value === 'string') text = JSON.stringify(value);
  else if (typeof value === 'number' || typeof value === 'boolean' || value === null) text = String(value);
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (typeof text !== 'string') text = String(text);
  if (text.length > MAX_ACTUAL) text = `${text.slice(0, MAX_ACTUAL)}…（共 ${text.length} 字符）`;
  return text;
}

/** 类型名（给「期望」描述与调试用） */
export function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** RFC6901 token 转义 */
export function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** 拼接 JSON Pointer：joinPointer('', ['items', 0, 'id']) → '/items/0/id' */
export function joinPointer(base, tokens) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  let out = base || '';
  for (const token of list) {
    if (token === undefined || token === null || token === '') continue;
    out += `/${escapePointerToken(token)}`;
  }
  return out;
}

/** 构造一条错误/警告诊断（内部与 data-schema 共用） */
export function makeDiagnostic(file, pointer, expected, actual, message) {
  const msg = message || `期望 ${expected}，实际 ${describeValue(actual)}`;
  return { file: file || '', pointer: pointer || '', expected: String(expected), actual, message: String(msg) };
}

/** 单行格式化，供测试失败时打印 */
export function formatDiagnostic(d) {
  const where = d.pointer ? d.pointer : '/';
  return `[${d.file}] ${where} — ${d.message}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function matchesType(value, type) {
  switch (type) {
    case 'any': return true;
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: throw new Error(`schema.mjs: 未知规则类型 ${type}`);
  }
}

function expectedTypes(rule) {
  const types = rule.type === undefined ? [] : Array.isArray(rule.type) ? rule.type : [rule.type];
  return types.map((type) => (type === 'integer' ? '整数' : type === 'array' ? '数组' : type === 'object' ? '对象' : type === 'number' ? '数字' : type === 'boolean' ? '布尔' : type === 'string' ? '字符串' : type === 'null' ? 'null' : type));
}

function pointerMatchPropertyName(key, rule) {
  if (rule.enum && !rule.enum.includes(key)) {
    return { ok: false, expected: `属性名 ∈ ${JSON.stringify(rule.enum)}` };
  }
  if (rule.pattern) {
    const re = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern);
    if (!re.test(key)) return { ok: false, expected: `属性名匹配 ${String(rule.pattern)}` };
  }
  if (rule.minLength !== undefined && key.length < rule.minLength) {
    return { ok: false, expected: `属性名长度 ≥ ${rule.minLength}` };
  }
  return { ok: true };
}

function makeCheckContext(file, pointer, errors, warnings) {
  const emit = (list, tokens, info) => {
    const diagPointer = joinPointer(pointer, tokens);
    const payload = info && typeof info === 'object' ? info : { actual: info };
    list.push(makeDiagnostic(file, diagPointer, payload.expected ?? '(未声明)', payload.actual, payload.message));
  };
  return {
    file,
    pointer,
    fail(tokens, info) { emit(errors, tokens, info); },
    warn(tokens, info) { emit(warnings, tokens, info); },
  };
}

function walk(value, rule, pointer, file, errors, warnings) {
  if (!rule || typeof rule !== 'object') return;
  if (value === undefined) return; // 缺字段由 required 负责报错

  if (value === null && rule.nullable) return;
  const types = rule.type === undefined ? null : Array.isArray(rule.type) ? rule.type : [rule.type];
  if (types && !types.some((type) => matchesType(value, type))) {
    errors.push(makeDiagnostic(file, pointer, expectedTypes(rule).join(' | ') || 'any', value));
    return;
  }

  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(makeDiagnostic(file, pointer, `枚举值 ${JSON.stringify(rule.enum)}`, value));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'const') && !deepEqual(value, rule.const)) {
    errors.push(makeDiagnostic(file, pointer, `常量 ${describeValue(rule.const)}`, value));
    return;
  }

  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      errors.push(makeDiagnostic(file, pointer, `长度 ≥ ${rule.minLength} 的非空字符串`, value));
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      errors.push(makeDiagnostic(file, pointer, `长度 ≤ ${rule.maxLength}`, value));
    }
    if (rule.pattern) {
      const re = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern);
      if (!re.test(value)) errors.push(makeDiagnostic(file, pointer, `匹配 ${String(rule.pattern)}`, value));
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (rule.minimum !== undefined && value < rule.minimum) {
      errors.push(makeDiagnostic(file, pointer, `≥ ${rule.minimum}`, value));
    }
    if (rule.maximum !== undefined && value > rule.maximum) {
      errors.push(makeDiagnostic(file, pointer, `≤ ${rule.maximum}`, value));
    }
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) {
      errors.push(makeDiagnostic(file, pointer, `数组长度 ≥ ${rule.minItems}`, value.length, `数组只有 ${value.length} 项（要求 ≥ ${rule.minItems}）`));
    }
    if (rule.maxItems !== undefined && value.length > rule.maxItems) {
      errors.push(makeDiagnostic(file, pointer, `数组长度 ≤ ${rule.maxItems}`, value.length, `数组有 ${value.length} 项（要求 ≤ ${rule.maxItems}）`));
    }
    if (rule.uniqueBy) {
      const seen = new Map();
      value.forEach((item, index) => {
        const key = typeof rule.uniqueBy === 'function' ? rule.uniqueBy(item) : isPlainObject(item) ? item[rule.uniqueBy] : undefined;
        if (key === undefined) return;
        if (seen.has(key)) {
          const first = seen.get(key);
          errors.push(makeDiagnostic(
            file,
            joinPointer(pointer, typeof rule.uniqueBy === 'function' ? [index] : [index, rule.uniqueBy]),
            `唯一（与第 ${first} 项重复：${describeValue(key)}）`,
            key,
            `重复值 ${describeValue(key)}：第 ${index} 项与第 ${first} 项相同（${typeof rule.uniqueBy === 'function' ? '复合键' : rule.uniqueBy} 必须唯一）`,
          ));
        } else {
          seen.set(key, index);
        }
      });
    }
    if (rule.items) {
      value.forEach((item, index) => walk(item, rule.items, joinPointer(pointer, index), file, errors, warnings));
    }
  }

  if (isPlainObject(value)) {
    if (Array.isArray(rule.required)) {
      for (const entry of rule.required) {
        const key = typeof entry === 'string' ? entry : entry.key;
        const why = typeof entry === 'string' ? '' : entry.why;
        if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
          errors.push(makeDiagnostic(
            file,
            joinPointer(pointer, key),
            `必填字段 ${key}${why ? `（原因：${why}）` : ''}`,
            undefined,
            `缺少必填字段 ${key}${why ? `：${why}` : ''}`,
          ));
        }
      }
    }
    const props = rule.properties || {};
    for (const [key, subRule] of Object.entries(props)) {
      if (value[key] !== undefined) walk(value[key], subRule, joinPointer(pointer, key), file, errors, warnings);
    }
    if (rule.propertyNames) {
      for (const key of Object.keys(value)) {
        const matched = pointerMatchPropertyName(key, rule.propertyNames);
        if (!matched.ok) {
          errors.push(makeDiagnostic(file, joinPointer(pointer, key), matched.expected, key, `键名 ${describeValue(key)} 不符合契约：${matched.expected}`));
        }
      }
    }
    if (rule.additionalProperties) {
      for (const key of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(props, key)) continue;
        walk(value[key], rule.additionalProperties, joinPointer(pointer, key), file, errors, warnings);
      }
    }
  }

  if (Array.isArray(rule.checks)) {
    const ctx = makeCheckContext(file, pointer, errors, warnings);
    for (const check of rule.checks) check(value, ctx);
  }
}

/**
 * 校验一个值。
 * @param {any} value
 * @param {object} rule
 * @param {{file?: string, pointer?: string}} [options]
 * @returns {{errors: Diagnostic[], warnings: Diagnostic[]}}
 */
export function validate(value, rule, options = {}) {
  const errors = [];
  const warnings = [];
  walk(value, rule, options.pointer || '', options.file || '', errors, warnings);
  return { errors, warnings };
}

/** 收集器：给 data-schema 的跨文件检查用（与 validate 的 ctx.fail/warn 同名同形） */
export function createCollector(file, errors, warnings) {
  return makeCheckContext(file, '', errors, warnings);
}
