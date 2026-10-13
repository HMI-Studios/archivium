// Bridges the Visual Builder form state to/from the raw CalendarDefinition JSON.
//
// The builder state mirrors the definition schema (values, conditions, durations, exceptions,
// functions, both subdivision kinds), so anything the engine can express can be edited visually.
// parseDefinition only accepts a definition if rebuilding it reproduces the exact same JSON; if
// not (an unknown condition type, a stray field...) it reports the first path that wouldn't
// survive, and the caller falls back to raw JSON editing rather than silently dropping parts.
import type { CalendarDefinition, CalendarFormat } from './calendars';

// ---- Values, conditions, durations ----

export type Value =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string }
  | { type: 'add' | 'subtract'; left: Value; right: Value };

export type CompareOp = '>' | '<' | '>=' | '<=' | '==' | '!=';
export const COMPARE_OPS: CompareOp[] = ['>', '<', '>=', '<=', '==', '!='];

export type Condition =
  | { type: 'function_call'; function: string; args: Value[] } // no args = the surrounding conditional's variable
  | { type: 'modulo'; value: Value | null; divisor: number; equals: number } // null value = the conditional's variable
  | { type: 'compare'; operator: CompareOp; left: Value; right: Value }
  | { type: 'and' | 'or'; conditions: Condition[] }
  | { type: 'not'; condition: Condition };

export type Duration =
  | { kind: 'fixed'; ticks: number }
  // first matching branch wins; defaultTicks null = no default (evaluates to 0 when nothing matches)
  | { kind: 'conditional'; variable: string; branches: { condition: Condition; ticks: number }[]; defaultTicks: number | null }
  | { kind: 'ternary'; condition: Condition; trueTicks: number; falseTicks: number };

export type Exception = { index: number; ticks: number }; // iteration index -> duration override

// ---- Calendar structure ----

export type LeapRule = { divisor: number; equals: number; value: Value; result: boolean };

export type BuilderFunction = { name: string } & (
  | { kind: 'leap_year'; rules: LeapRule[] } // evaluated in order; first match wins; no match = false
  | { kind: 'cycle_position'; cycleLength: number; positions: number[] }
);

export type BuilderUnit = {
  name: string;
  duration: Duration;
  exceptions: Exception[];
};

export type BuilderSubdivision =
  | { type: 'named_sequence'; units: BuilderUnit[] }
  | { type: 'uniform'; id: string; durationTicks: number };

export type BuilderCycle = {
  id: string;
  duration: Duration;
  estimatedTicks: number | null; // null = derive from duration (see autoEstimate); only for non-fixed durations
  exceptions: Exception[];
  subdivisions: BuilderSubdivision[];
};

export type BuilderIndependentCycle = {
  id: string;
  durationTicks: number;
  period: number;
  names: string[];
};

// A date format is an ordered list of segments. Compiles to the engine's { str, keys } form:
// every field becomes a "%s" in str (two, for a field with an ordinal suffix) and pushes its key
// (plus "offset, add" / "width, zero_pad" / "ordinal_suff" operations, in that order) onto keys.
export type FormatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'field'; key: string; offset: number; pad: number; ordinal: boolean }; // pad: zero-pad width, 0 = none

export type BuilderState = {
  name: string;
  epochTimestamp: number;
  cycles: BuilderCycle[];
  independentCycles: BuilderIndependentCycle[];
  functions: BuilderFunction[];
  format: FormatSegment[]; // empty = no format (decoded dates show as raw JSON)
};

export function blankBuilderState(): BuilderState {
  return {
    name: 'New Calendar',
    epochTimestamp: 0,
    cycles: [{ id: 'day', duration: { kind: 'fixed', ticks: 1 }, estimatedTicks: null, exceptions: [], subdivisions: [] }],
    independentCycles: [],
    functions: [],
    format: [],
  };
}

// ---- Factories & helpers used by the form ----

export function newCondition(functionNames: string[], variable: string): Condition {
  if (functionNames.length) {
    return { type: 'function_call', function: functionNames[0], args: [{ type: 'variable', name: variable }] };
  }
  return { type: 'compare', operator: '>=', left: { type: 'variable', name: variable }, right: { type: 'number', value: 0 } };
}

// What the engine's cycle sorting should see when the user hasn't set an estimate explicitly:
// the "normal" length, i.e. the default branch / false value.
export function autoEstimate(d: Duration): number {
  if (d.kind === 'fixed') return d.ticks;
  if (d.kind === 'ternary') return d.falseTicks;
  return d.defaultTicks ?? d.branches[0]?.ticks ?? 0;
}

// Turns a fixed-duration cycle into a leap-style one: a leap_year function (created if missing)
// and a conditional duration with a leap branch and a default, both starting at the old length.
export function makeLeapStyle(state: BuilderState, cycleIndex: number): BuilderState {
  const cycle = state.cycles[cycleIndex];
  if (cycle.duration.kind !== 'fixed') return state;
  const base = cycle.duration.ticks;
  const variable = `${cycle.id}_index`;
  const fnName = `is_leap_${cycle.id}`;

  const functions: BuilderFunction[] = state.functions.some(f => f.name === fnName)
    ? state.functions
    : [...state.functions, {
      name: fnName, kind: 'leap_year',
      rules: [{ divisor: 4, equals: 0, value: { type: 'variable', name: variable }, result: true }],
    }];

  const duration: Duration = {
    kind: 'conditional', variable,
    branches: [{ condition: { type: 'function_call', function: fnName, args: [{ type: 'variable', name: variable }] }, ticks: base }],
    defaultTicks: base,
  };
  const cycles = state.cycles.map((c, i) => (i === cycleIndex ? { ...c, duration, estimatedTicks: null } : c));
  return { ...state, functions, cycles };
}

function transformCondition(c: Condition, f: (c: Condition) => Condition): Condition {
  let inner = c;
  if (c.type === 'and' || c.type === 'or') inner = { ...c, conditions: c.conditions.map(x => transformCondition(x, f)) };
  else if (c.type === 'not') inner = { ...c, condition: transformCondition(c.condition, f) };
  return f(inner);
}

function transformDuration(d: Duration, f: (c: Condition) => Condition): Duration {
  if (d.kind === 'conditional') return { ...d, branches: d.branches.map(b => ({ ...b, condition: transformCondition(b.condition, f) })) };
  if (d.kind === 'ternary') return { ...d, condition: transformCondition(d.condition, f) };
  return d;
}

// Renames a function and every function_call that references it.
export function renameFunction(state: BuilderState, index: number, newName: string): BuilderState {
  const oldName = state.functions[index].name;
  const f = (c: Condition): Condition => (c.type === 'function_call' && c.function === oldName ? { ...c, function: newName } : c);
  return {
    ...state,
    functions: state.functions.map((fn, i) => (i === index ? { ...fn, name: newName } : fn)),
    cycles: state.cycles.map(c => ({
      ...c,
      duration: transformDuration(c.duration, f),
      subdivisions: c.subdivisions.map(s => s.type === 'named_sequence'
        ? { ...s, units: s.units.map(u => ({ ...u, duration: transformDuration(u.duration, f) })) }
        : s),
    })),
  };
}

export type FormatField = { key: string; label: string; numeric: boolean };

// The data keys CalendarSystem.timestampToCalendar will actually produce for this builder state.
// `numeric` is false for name-valued fields, where an offset or ordinal suffix makes no sense.
export function availableFormatFields(state: BuilderState): FormatField[] {
  const fields: FormatField[] = [];
  for (const c of state.cycles) {
    fields.push({ key: c.id, label: c.id, numeric: true });
    for (const s of c.subdivisions) {
      if (s.type === 'named_sequence') {
        fields.push({ key: `${c.id}_subdivision`, label: `${c.id}_subdivision (name)`, numeric: false });
        fields.push({ key: `${c.id}_subdivision_index`, label: `${c.id}_subdivision_index`, numeric: true });
      } else {
        fields.push({ key: s.id, label: s.id, numeric: true });
      }
    }
  }
  for (const ic of state.independentCycles) {
    const named = ic.names.some(Boolean);
    fields.push({ key: ic.id, label: named ? `${ic.id} (name)` : ic.id, numeric: !named });
  }
  return fields;
}

// Variable names a condition or value can read (the engine's context at that point).
export function availableVariables(state: BuilderState): string[] {
  const names = new Set<string>();
  for (const c of state.cycles) names.add(`${c.id}_index`);
  for (const f of availableFormatFields(state)) names.add(f.key);
  names.add('timestamp');
  names.add('elapsed');
  return [...names];
}

// ---- Format compile / parse ----

export function compileFormat(segments: FormatSegment[]): CalendarFormat | undefined {
  if (!segments.length) return undefined;
  let str = '';
  const keys: (string | number)[] = [];
  for (const seg of segments) {
    if (seg.kind === 'text') {
      str += seg.text;
      continue;
    }
    keys.push(seg.key);
    if (seg.offset) keys.push(seg.offset, 'add');
    if (seg.pad) keys.push(seg.pad, 'zero_pad');
    str += '%s';
    if (seg.ordinal) {
      keys.push('ordinal_suff');
      str += '%s';
    }
  }
  return { str, keys };
}

// Inverse of compileFormat. Returns null for formats it can't represent (literal-number keys
// outside an offset, an ordinal suffix separated from its number, mismatched placeholder counts).
export function parseFormat(format: CalendarFormat): FormatSegment[] | null {
  if (!format || typeof format.str !== 'string' || !Array.isArray(format.keys)) return null;

  type Item = { kind: 'field'; key: string; offset: number; pad: number; ordinal: boolean } | { kind: 'num'; n: number };
  const items: Item[] = [];
  for (const k of format.keys) {
    if (k === 'add') {
      const b = items.pop();
      const a = items.pop();
      if (!a || !b || a.kind !== 'field' || a.ordinal || a.pad !== 0 || a.offset !== 0 || b.kind !== 'num') return null;
      a.offset = b.n;
      items.push(a);
    } else if (k === 'zero_pad') {
      const b = items.pop();
      const a = items.pop();
      if (!a || !b || a.kind !== 'field' || a.ordinal || a.pad !== 0 || b.kind !== 'num' || b.n <= 0) return null;
      a.pad = b.n;
      items.push(a);
    } else if (k === 'ordinal_suff') {
      const last = items[items.length - 1];
      if (!last || last.kind !== 'field' || last.ordinal) return null;
      last.ordinal = true;
    } else if (typeof k === 'number') {
      items.push({ kind: 'num', n: k });
    } else {
      items.push({ kind: 'field', key: k, offset: 0, pad: 0, ordinal: false });
    }
  }

  const parts = format.str.split('%s'); // parts[i] is the text after the i-th placeholder
  const segments: FormatSegment[] = [];
  const pushText = (text: string) => { if (text) segments.push({ kind: 'text', text }); };

  pushText(parts[0]);
  let p = 1;
  for (const item of items) {
    if (item.kind !== 'field') return null;
    segments.push({ kind: 'field', key: item.key, offset: item.offset, pad: item.pad, ordinal: item.ordinal });
    if (item.ordinal) {
      if (parts[p] !== '') return null; // suffix must directly follow its number
      p++;
    }
    if (p >= parts.length) return null;
    pushText(parts[p]);
    p++;
  }
  if (p !== parts.length) return null; // placeholders left over with no value

  return segments;
}

// ---- State -> definition ----

function buildValue(v: Value): any {
  if (v.type === 'number') return v.value;
  if (v.type === 'variable') return { type: 'variable', name: v.name };
  return { type: v.type, left: buildValue(v.left), right: buildValue(v.right) };
}

function buildCondition(c: Condition): any {
  switch (c.type) {
    case 'function_call': {
      const out: any = { type: 'function_call', function: c.function };
      if (c.args.length) out.args = c.args.map(buildValue);
      return out;
    }
    case 'modulo': {
      const out: any = { type: 'modulo' };
      if (c.value) out.value = buildValue(c.value);
      out.divisor = c.divisor;
      out.equals = c.equals;
      return out;
    }
    case 'compare':
      return { type: 'compare', operator: c.operator, left: buildValue(c.left), right: buildValue(c.right) };
    case 'and':
    case 'or':
      return { type: c.type, conditions: c.conditions.map(buildCondition) };
    case 'not':
      return { type: 'not', condition: buildCondition(c.condition) };
  }
}

function buildDuration(target: any, d: Duration) {
  if (d.kind === 'fixed') {
    target.duration_ticks = d.ticks;
  } else if (d.kind === 'ternary') {
    target.duration_fn = {
      type: 'expression', operator: 'ternary',
      condition: buildCondition(d.condition), true_value: d.trueTicks, false_value: d.falseTicks,
    };
  } else {
    const conditions: any[] = d.branches.map(b => ({ if: buildCondition(b.condition), duration_ticks: b.ticks }));
    if (d.defaultTicks !== null) conditions.push({ default: true, duration_ticks: d.defaultTicks });
    target.duration_fn = { type: 'conditional', variable: d.variable, conditions };
  }
}

function buildExceptions(target: any, exceptions: Exception[]) {
  if (!exceptions.length) return;
  target.exceptions = {};
  for (const e of exceptions) target.exceptions[e.index] = e.ticks;
}

function buildFunction(f: BuilderFunction): any {
  if (f.kind === 'leap_year') {
    return {
      type: 'leap_year',
      rules: f.rules.map(r => ({
        condition: { type: 'modulo', divisor: r.divisor, equals: r.equals },
        value: buildValue(r.value),
        result: r.result,
      })),
    };
  }
  return { type: 'cycle_position', cycle_length: f.cycleLength, positions: f.positions };
}

export function buildDefinition(state: BuilderState): CalendarDefinition {
  const cycles = state.cycles.map(c => {
    const cycle: any = { id: c.id };
    if (c.duration.kind !== 'fixed') cycle.estimated_duration_ticks = c.estimatedTicks ?? autoEstimate(c.duration);
    buildDuration(cycle, c.duration);
    buildExceptions(cycle, c.exceptions);

    if (c.subdivisions.length) {
      cycle.subdivisions = c.subdivisions.map(s => {
        if (s.type === 'uniform') return { type: 'uniform', id: s.id, duration_ticks: s.durationTicks };
        return {
          type: 'named_sequence',
          units: s.units.map(u => {
            const unit: any = { name: u.name };
            buildDuration(unit, u.duration);
            buildExceptions(unit, u.exceptions);
            return unit;
          }),
        };
      });
    }
    return cycle;
  });

  const def: CalendarDefinition = { name: state.name, epoch: { timestamp: state.epochTimestamp }, cycles };
  const format = compileFormat(state.format);
  if (format) def.format = format;
  if (state.functions.length) {
    def.functions = {};
    for (const f of state.functions) def.functions[f.name] = buildFunction(f);
  }
  if (state.independentCycles.length) {
    // An empty names array isn't "no names" to the engine (it would index into it and get undefined),
    // so only emit the key when there's at least one real name.
    def.independent_cycles = state.independentCycles.map(ic => ({
      id: ic.id, duration_ticks: ic.durationTicks, period: ic.period,
      ...(ic.names.some(Boolean) ? { names: ic.names } : {}),
    }));
  }
  return def;
}

// ---- Definition -> state ----

class Unsupported extends Error {}

const isNum = (x: any): x is number => typeof x === 'number' && Number.isFinite(x);

function parseValue(v: any, path: string): Value {
  if (isNum(v)) return { type: 'number', value: v };
  if (v && typeof v === 'object') {
    if (v.type === 'variable' && typeof v.name === 'string') return { type: 'variable', name: v.name };
    if (v.type === 'add' || v.type === 'subtract') {
      return { type: v.type, left: parseValue(v.left, `${path}.left`), right: parseValue(v.right, `${path}.right`) };
    }
  }
  throw new Unsupported(path);
}

function parseCondition(c: any, path: string): Condition {
  if (!c || typeof c !== 'object') throw new Unsupported(path);
  switch (c.type) {
    case 'function_call':
      if (typeof c.function !== 'string') throw new Unsupported(`${path}.function`);
      if (c.args !== undefined && !Array.isArray(c.args)) throw new Unsupported(`${path}.args`);
      return { type: 'function_call', function: c.function, args: (c.args ?? []).map((a: any, i: number) => parseValue(a, `${path}.args[${i}]`)) };
    case 'modulo':
      if (!isNum(c.divisor)) throw new Unsupported(`${path}.divisor`);
      if (!isNum(c.equals)) throw new Unsupported(`${path}.equals`);
      return { type: 'modulo', value: c.value === undefined ? null : parseValue(c.value, `${path}.value`), divisor: c.divisor, equals: c.equals };
    case 'compare':
      if (!COMPARE_OPS.includes(c.operator)) throw new Unsupported(`${path}.operator`);
      return { type: 'compare', operator: c.operator, left: parseValue(c.left, `${path}.left`), right: parseValue(c.right, `${path}.right`) };
    case 'and':
    case 'or':
      if (!Array.isArray(c.conditions)) throw new Unsupported(`${path}.conditions`);
      return { type: c.type, conditions: c.conditions.map((x: any, i: number) => parseCondition(x, `${path}.conditions[${i}]`)) };
    case 'not':
      return { type: 'not', condition: parseCondition(c.condition, `${path}.condition`) };
  }
  throw new Unsupported(`${path}.type`);
}

// `src` is a cycle or a unit: either duration_ticks or duration_fn.
function parseDuration(src: any, path: string): Duration {
  const fn = src.duration_fn;
  if (fn === undefined) {
    if (!isNum(src.duration_ticks)) throw new Unsupported(`${path}.duration_ticks`);
    return { kind: 'fixed', ticks: src.duration_ticks };
  }

  const fnPath = `${path}.duration_fn`;
  if (fn && fn.type === 'expression' && fn.operator === 'ternary') {
    if (!isNum(fn.true_value)) throw new Unsupported(`${fnPath}.true_value`);
    if (!isNum(fn.false_value)) throw new Unsupported(`${fnPath}.false_value`);
    return { kind: 'ternary', condition: parseCondition(fn.condition, `${fnPath}.condition`), trueTicks: fn.true_value, falseTicks: fn.false_value };
  }

  if (fn && fn.type === 'conditional') {
    if (typeof fn.variable !== 'string') throw new Unsupported(`${fnPath}.variable`);
    if (!Array.isArray(fn.conditions)) throw new Unsupported(`${fnPath}.conditions`);
    const branches: { condition: Condition; ticks: number }[] = [];
    let defaultTicks: number | null = null;
    fn.conditions.forEach((entry: any, i: number) => {
      const p = `${fnPath}.conditions[${i}]`;
      if (!entry || !isNum(entry.duration_ticks)) throw new Unsupported(`${p}.duration_ticks`);
      if (entry.default) {
        if (i !== fn.conditions.length - 1) throw new Unsupported(`${p}.default`); // anything after a default is unreachable
        defaultTicks = entry.duration_ticks;
      } else {
        branches.push({ condition: parseCondition(entry.if, `${p}.if`), ticks: entry.duration_ticks });
      }
    });
    return { kind: 'conditional', variable: fn.variable, branches, defaultTicks };
  }

  throw new Unsupported(`${fnPath}.type`);
}

function parseExceptions(src: any, path: string): Exception[] {
  if (src.exceptions === undefined) return [];
  const raw = src.exceptions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Unsupported(`${path}.exceptions`);
  return Object.entries(raw).map(([k, v]) => {
    const index = Number(k);
    if (!Number.isInteger(index)) throw new Unsupported(`${path}.exceptions.${k}`);
    if (!isNum(v)) throw new Unsupported(`${path}.exceptions.${k}`);
    return { index, ticks: v };
  });
}

function parseFunction(name: string, f: any): BuilderFunction {
  const path = `functions.${name}`;
  if (f && f.type === 'leap_year' && Array.isArray(f.rules)) {
    const rules: LeapRule[] = f.rules.map((r: any, i: number) => {
      const p = `${path}.rules[${i}]`;
      if (!r || !r.condition || r.condition.type !== 'modulo') throw new Unsupported(`${p}.condition`);
      if (!isNum(r.condition.divisor)) throw new Unsupported(`${p}.condition.divisor`);
      if (!isNum(r.condition.equals)) throw new Unsupported(`${p}.condition.equals`);
      if (typeof r.result !== 'boolean') throw new Unsupported(`${p}.result`);
      return { divisor: r.condition.divisor, equals: r.condition.equals, value: parseValue(r.value, `${p}.value`), result: r.result };
    });
    return { name, kind: 'leap_year', rules };
  }
  if (f && f.type === 'cycle_position') {
    if (!isNum(f.cycle_length)) throw new Unsupported(`${path}.cycle_length`);
    if (!Array.isArray(f.positions) || !f.positions.every(isNum)) throw new Unsupported(`${path}.positions`);
    return { name, kind: 'cycle_position', cycleLength: f.cycle_length, positions: f.positions };
  }
  throw new Unsupported(`${path}.type`);
}

function parseSubdivision(s: any, path: string): BuilderSubdivision {
  if (s && s.type === 'uniform') {
    if (typeof s.id !== 'string') throw new Unsupported(`${path}.id`);
    if (!isNum(s.duration_ticks)) throw new Unsupported(`${path}.duration_ticks`);
    return { type: 'uniform', id: s.id, durationTicks: s.duration_ticks };
  }
  if (s && s.type === 'named_sequence') {
    if (!Array.isArray(s.units)) throw new Unsupported(`${path}.units`);
    return {
      type: 'named_sequence',
      units: s.units.map((u: any, i: number): BuilderUnit => {
        const p = `${path}.units[${i}]`;
        if (!u || typeof u.name !== 'string') throw new Unsupported(`${p}.name`);
        return { name: u.name, duration: parseDuration(u, p), exceptions: parseExceptions(u, p) };
      }),
    };
  }
  throw new Unsupported(`${path}.type`);
}

function parseCycle(c: any, path: string): BuilderCycle {
  if (!c || typeof c.id !== 'string') throw new Unsupported(`${path}.id`);
  const duration = parseDuration(c, path);
  let estimatedTicks: number | null = null;
  if (c.estimated_duration_ticks !== undefined) {
    if (!isNum(c.estimated_duration_ticks) || duration.kind === 'fixed') throw new Unsupported(`${path}.estimated_duration_ticks`);
    estimatedTicks = c.estimated_duration_ticks === autoEstimate(duration) ? null : c.estimated_duration_ticks;
  }
  if (c.subdivisions !== undefined && !Array.isArray(c.subdivisions)) throw new Unsupported(`${path}.subdivisions`);
  return {
    id: c.id,
    duration,
    estimatedTicks,
    exceptions: parseExceptions(c, path),
    subdivisions: (c.subdivisions ?? []).map((s: any, i: number) => parseSubdivision(s, `${path}.subdivisions[${i}]`)),
  };
}

// Empty containers the builder never emits but the engine treats the same as absent (apart from
// `names: []`, which the engine treats as "has names" - the builder drops it, deliberately).
function isIgnorable(key: string, value: any): boolean {
  if ((key === 'names' || key === 'args' || key === 'independent_cycles') && Array.isArray(value) && value.length === 0) return true;
  if (key === 'functions' && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return true;
  return false;
}

// Path of the first difference between two JSON values (object key order is irrelevant), or null.
function firstDifference(a: any, b: any, path: string): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return path;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const av = a[k], bv = b[k];
      const childPath = path ? `${path}.${k}` : k;
      if ((av === undefined || isIgnorable(k, av)) && (bv === undefined || isIgnorable(k, bv))) continue;
      if (av === undefined || bv === undefined) return childPath;
      const d = firstDifference(av, bv, childPath);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : path;
}

export type ParseResult = { state: BuilderState; error?: undefined } | { state?: undefined; error: string };

// On failure, `error` is the JSON path of the first part the visual builder can't represent.
export function parseDefinition(input: CalendarDefinition): ParseResult {
  try {
    if (!input || typeof input !== 'object' || !Array.isArray(input.cycles)) throw new Unsupported('cycles');
    const def = JSON.parse(JSON.stringify(input));

    const independentCycles: BuilderIndependentCycle[] = (def.independent_cycles ?? []).map((ic: any, i: number) => {
      const p = `independent_cycles[${i}]`;
      if (typeof ic.id !== 'string') throw new Unsupported(`${p}.id`);
      if (!isNum(ic.duration_ticks)) throw new Unsupported(`${p}.duration_ticks`);
      if (!isNum(ic.period)) throw new Unsupported(`${p}.period`);
      if (ic.names !== undefined && (!Array.isArray(ic.names) || !ic.names.every((n: any) => typeof n === 'string'))) throw new Unsupported(`${p}.names`);
      return { id: ic.id, durationTicks: ic.duration_ticks, period: ic.period, names: ic.names ?? [] };
    });

    const format = def.format ? parseFormat(def.format) : [];
    if (!format) throw new Unsupported('format');

    const state: BuilderState = {
      name: def.name ?? 'Calendar',
      epochTimestamp: def.epoch?.timestamp ?? 0,
      cycles: def.cycles.map((c: any, i: number) => parseCycle(c, `cycles[${i}]`)),
      independentCycles,
      functions: Object.entries(def.functions ?? {}).map(([name, f]) => parseFunction(name, f)),
      format,
    };

    // Safety net: refuse anything that wouldn't come back out identical.
    const diff = firstDifference(def, JSON.parse(JSON.stringify(buildDefinition(state))), '');
    if (diff) throw new Unsupported(diff);

    return { state };
  } catch (err) {
    if (err instanceof Unsupported) return { error: err.message };
    throw err;
  }
}

export function tryParseIntoBuilderState(def: CalendarDefinition): BuilderState | null {
  return parseDefinition(def).state ?? null;
}
