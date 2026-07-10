// Bridges the Visual Builder form state to/from the raw CalendarDefinition JSON.
// Intentionally covers only the "basic" subset of the engine's features (fixed-duration
// cycles, single leap-rule-chain variable cycles, named-sequence subdivisions with an
// optional leap bonus, and independent cycles). Anything fancier (era comparisons,
// exceptions, arbitrary and/or/not nesting) has to be edited as raw JSON - see
// tryParseIntoBuilderState, which refuses to touch a definition it can't losslessly
// round-trip through this simplified shape.
import type { CalendarDefinition } from './calendars';

export type LeapRule = { divisor: number; equals: number; result: boolean };

export type BuilderUnit = {
  name: string;
  durationTicks: number;
  leapBonusTicks: number; // 0 = no leap dependence
};

export type BuilderCycle = {
  id: string;
  kind: 'fixed' | 'leap';
  durationTicks: number; // fixed: the duration; leap: the non-leap (base) duration
  leapBonusTicks: number; // leap only: added to durationTicks in a leap iteration
  leapRules: LeapRule[]; // leap only: evaluated in order, first match wins, else "not leap"
  subdivisions: BuilderUnit[]; // named_sequence units, optional (usually only on the largest cycle)
};

export type BuilderIndependentCycle = {
  id: string;
  durationTicks: number;
  period: number;
  names: string[];
};

export type BuilderState = {
  name: string;
  epochTimestamp: number;
  cycles: BuilderCycle[];
  independentCycles: BuilderIndependentCycle[];
};

export function blankBuilderState(): BuilderState {
  return {
    name: 'New Calendar',
    epochTimestamp: 0,
    cycles: [{ id: 'day', kind: 'fixed', durationTicks: 1, leapBonusTicks: 0, leapRules: [], subdivisions: [] }],
    independentCycles: [],
  };
}

function leapFunctionName(cycleId: string) {
  return `is_leap_${cycleId}`;
}

function leapCondition(cycleId: string) {
  return {
    type: 'function_call',
    function: leapFunctionName(cycleId),
    args: [{ type: 'variable', name: 'year_index' }],
  };
}

export function buildDefinition(state: BuilderState): CalendarDefinition {
  const functions: { [name: string]: any } = {};

  const cycles = state.cycles.map(c => {
    if (c.kind === 'fixed') {
      return { id: c.id, duration_ticks: c.durationTicks };
    }

    functions[leapFunctionName(c.id)] = {
      type: 'leap_year',
      rules: c.leapRules.map(r => ({
        condition: { type: 'modulo', divisor: r.divisor, equals: r.equals },
        value: { type: 'variable', name: 'year_index' },
        result: r.result,
      })),
    };

    const cond = leapCondition(c.id);
    const cycle: any = {
      id: c.id,
      estimated_duration_ticks: c.durationTicks,
      duration_fn: {
        type: 'conditional',
        variable: 'year_index',
        conditions: [
          { if: cond, duration_ticks: c.durationTicks + c.leapBonusTicks },
          { default: true, duration_ticks: c.durationTicks },
        ],
      },
    };

    if (c.subdivisions.length) {
      cycle.subdivisions = [{
        type: 'named_sequence',
        units: c.subdivisions.map(u => {
          if (u.leapBonusTicks) {
            return {
              name: u.name,
              duration_fn: {
                type: 'expression',
                operator: 'ternary',
                condition: cond,
                true_value: u.durationTicks + u.leapBonusTicks,
                false_value: u.durationTicks,
              },
            };
          }
          return { name: u.name, duration_ticks: u.durationTicks };
        }),
      }];
    }

    return cycle;
  });

  const def: CalendarDefinition = { name: state.name, epoch: { timestamp: state.epochTimestamp }, cycles };
  if (Object.keys(functions).length) def.functions = functions;
  if (state.independentCycles.length) {
    def.independent_cycles = state.independentCycles.map(ic => ({
      id: ic.id, duration_ticks: ic.durationTicks, period: ic.period, names: ic.names,
    }));
  }
  return def;
}

// Returns null if `def` uses anything outside the basic subset above - callers should
// fall back to raw JSON editing rather than risk silently dropping the unsupported parts.
export function tryParseIntoBuilderState(def: CalendarDefinition): BuilderState | null {
  if (!def || typeof def !== 'object' || !Array.isArray(def.cycles)) return null;

  const cycles: BuilderCycle[] = [];

  for (const cycle of def.cycles) {
    if (cycle.duration_ticks !== undefined && !cycle.duration_fn) {
      if (cycle.exceptions || cycle.subdivisions) return null; // fixed cycles aren't expected to have either
      cycles.push({ id: cycle.id, kind: 'fixed', durationTicks: cycle.duration_ticks, leapBonusTicks: 0, leapRules: [], subdivisions: [] });
      continue;
    }

    if (cycle.exceptions) return null;
    const leap = parseLeapCycle(cycle, def.functions ?? {});
    if (!leap) return null;
    cycles.push(leap);
  }

  const independentCycles: BuilderIndependentCycle[] = [];
  for (const ic of def.independent_cycles ?? []) {
    if (typeof ic.duration_ticks !== 'number' || typeof ic.period !== 'number') return null;
    independentCycles.push({ id: ic.id, durationTicks: ic.duration_ticks, period: ic.period, names: ic.names ?? [] });
  }

  return {
    name: def.name ?? 'Calendar',
    epochTimestamp: def.epoch?.timestamp ?? 0,
    cycles,
    independentCycles,
  };
}

function parseLeapCycle(cycle: any, functions: { [name: string]: any }): BuilderCycle | null {
  const fn = cycle.duration_fn;
  if (!fn || fn.type !== 'conditional' || fn.variable !== 'year_index') return null;
  if (!Array.isArray(fn.conditions) || fn.conditions.length !== 2) return null;

  const [leapCond, defaultCond] = fn.conditions;
  if (!defaultCond.default) return null;
  if (!leapCond.if || leapCond.if.type !== 'function_call') return null;

  const funcName = leapCond.if.function;
  const funcDef = functions[funcName];
  if (!funcDef || funcDef.type !== 'leap_year') return null;

  const leapRules: LeapRule[] = [];
  for (const rule of funcDef.rules) {
    if (!rule.condition || rule.condition.type !== 'modulo') return null;
    if (rule.value?.type !== 'variable' || rule.value?.name !== 'year_index') return null;
    leapRules.push({ divisor: rule.condition.divisor, equals: rule.condition.equals, result: !!rule.result });
  }

  const durationTicks = defaultCond.duration_ticks;
  const leapBonusTicks = leapCond.duration_ticks - durationTicks;

  const subdivisions: BuilderUnit[] = [];
  if (cycle.subdivisions) {
    if (cycle.subdivisions.length !== 1 || cycle.subdivisions[0].type !== 'named_sequence') return null;
    for (const unit of cycle.subdivisions[0].units) {
      if (unit.duration_ticks !== undefined && !unit.duration_fn) {
        if (unit.exceptions) return null;
        subdivisions.push({ name: unit.name, durationTicks: unit.duration_ticks, leapBonusTicks: 0 });
        continue;
      }
      if (unit.exceptions) return null;
      const uf = unit.duration_fn;
      if (!uf || uf.type !== 'expression' || uf.operator !== 'ternary') return null;
      if (!uf.condition || uf.condition.type !== 'function_call' || uf.condition.function !== funcName) return null;
      subdivisions.push({ name: unit.name, durationTicks: uf.false_value, leapBonusTicks: uf.true_value - uf.false_value });
    }
  }

  return { id: cycle.id, kind: 'leap', durationTicks, leapBonusTicks, leapRules, subdivisions };
}
