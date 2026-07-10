// Ported from src/lib/calendars.js for use in the browser bundle - that file mixes the
// library with executable demo/test code, so it can't be imported directly here.
// Keep changes to the core algorithm in sync between the two copies until they're unified.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CalendarDefinition = any;
export type CalendarData = { [key: string]: any };

export class CalendarSystem {
  def: CalendarDefinition;
  functions: { [name: string]: any };

  constructor(definition: CalendarDefinition) {
    this.def = definition;
    this.functions = definition.functions || {};
  }

  timestampToCalendar(timestamp: number): CalendarData {
    const elapsed = timestamp + this.def.epoch.timestamp;
    const result: CalendarData = { timestamp, elapsed };

    const cycles = this.getSortedCycles();
    let remaining = elapsed;

    for (const cycle of cycles) {
      const cycleResult = this.processCycle(cycle, remaining, result);
      result[cycle.id] = cycleResult.count;
      result[`${cycle.id}_index`] = cycleResult.count;
      remaining = cycleResult.remaining;

      if (cycle.subdivisions) {
        const subdivResult = this.processSubdivisions(
          cycle.subdivisions,
          cycleResult.remaining,
          result,
          cycle.id
        );
        Object.assign(result, subdivResult.data);
        remaining = subdivResult.remaining;
      }
    }

    if (elapsed < 0) result[cycles[0].id] -= 1;

    if (this.def.independent_cycles) {
      for (const ic of this.def.independent_cycles) {
        result[ic.id] = this.processIndependentCycle(ic, elapsed);
      }
    }

    return result;
  }

  processIndependentCycle(cycle: any, elapsed: number) {
    const unitCount = Math.floor(elapsed / cycle.duration_ticks);
    const position = ((unitCount % cycle.period) + cycle.period) % cycle.period;
    return cycle.names ? cycle.names[position] : position;
  }

  getOverride(source: any, index: number | undefined) {
    if (!source || !source.exceptions || index === undefined) return undefined;
    return source.exceptions[index];
  }

  calendarToTimestamp(calendarData: CalendarData): number {
    let timestamp = -this.def.epoch.timestamp;
    const cycles = this.getSortedCycles();

    for (const cycle of cycles) {
      const count = calendarData[cycle.id] || 0;

      if (cycle.duration_fn) {
        if (count >= 0) {
          for (let i = 0; i < count; i++) {
            const override = this.getOverride(cycle, i);
            const duration = override !== undefined ? override : this.evaluateDurationFn(cycle.duration_fn, {
              ...calendarData,
              [`${cycle.id}_index`]: i
            });
            timestamp += duration;
          }
        } else {
          for (let i = -1; i >= count; i--) {
            const override = this.getOverride(cycle, i);
            const duration = override !== undefined ? override : this.evaluateDurationFn(cycle.duration_fn, {
              ...calendarData,
              [`${cycle.id}_index`]: i
            });
            timestamp -= duration;
          }
        }
      } else if (cycle.duration_ticks) {
        timestamp += count * cycle.duration_ticks;
      }

      if (cycle.subdivisions) {
        timestamp += this.calculateSubdivisionTime(
          cycle.subdivisions,
          { ...calendarData, [`${cycle.id}_index`]: count },
          cycle.id
        );
      }
    }

    return timestamp;
  }

  calculateSubdivisionTime(subdivisions: any[], calendarData: CalendarData, parentId: string) {
    let elapsed = 0;

    for (const subdiv of subdivisions) {
      if (subdiv.type === 'uniform') {
        const count = calendarData[subdiv.id] || 0;
        elapsed += count * subdiv.duration_ticks;
      } else if (subdiv.type === 'named_sequence') {
        const subdivisionIndex = calendarData[`${parentId}_subdivision_index`];

        if (subdivisionIndex !== undefined) {
          for (let i = 0; i < subdivisionIndex; i++) {
            const unit = subdiv.units[i];
            const duration = this.resolveDuration(unit, calendarData, parentId);
            elapsed += duration;
          }
        }
      }
    }

    return elapsed;
  }

  processCycle(cycle: any, remaining: number, context: CalendarData) {
    if (cycle.duration_fn) {
      return this.countVariableCycles(cycle, remaining, context);
    } else {
      const duration = cycle.duration_ticks;

      let count: number, remainder: number;
      if (remaining >= 0) {
        count = Math.floor(remaining / duration);
        remainder = remaining % duration;
      } else {
        count = Math.floor(remaining / duration);
        remainder = remaining - (count * duration);

        if (remainder < 0) {
          count -= 1;
          remainder += duration;
        }
      }

      return { count, remaining: remainder };
    }
  }

  countVariableCycles(cycle: any, remaining: number, context: CalendarData) {
    let count = 0;
    let accumulated = 0;

    if (remaining >= 0) {
      while (true) {
        const override = this.getOverride(cycle, count);
        const duration = override !== undefined ? override : this.evaluateDurationFn(cycle.duration_fn, {
          ...context,
          [`${cycle.id}_index`]: count
        });

        if (accumulated + duration > remaining) {
          break;
        }

        accumulated += duration;
        count++;
      }
    } else {
      while (true) {
        count--;
        const override = this.getOverride(cycle, count);
        const duration = override !== undefined ? override : this.evaluateDurationFn(cycle.duration_fn, {
          ...context,
          [`${cycle.id}_index`]: count
        });

        if (accumulated - duration < remaining) {
          count++;
          break;
        }

        accumulated -= duration;
      }
    }

    return { count, remaining: remaining - accumulated };
  }

  processSubdivisions(subdivisions: any[], remaining: number, context: CalendarData, parentId: string) {
    const data: CalendarData = {};
    let currentRemaining = remaining;

    for (const subdiv of subdivisions) {
      if (subdiv.type === 'uniform') {
        const duration = subdiv.duration_ticks;

        let count: number, remainder: number;
        if (currentRemaining >= 0) {
          count = Math.floor(currentRemaining / duration);
          remainder = currentRemaining % duration;
        } else {
          count = Math.floor(currentRemaining / duration);
          remainder = currentRemaining - (count * duration);

          if (remainder < 0) {
            count -= 1;
            remainder += duration;
          }
        }

        data[subdiv.id] = count;
        currentRemaining = remainder;
      } else if (subdiv.type === 'named_sequence') {
        const result = this.processNamedSequence(subdiv.units, currentRemaining, context, parentId);
        data[`${parentId}_subdivision`] = result.name;
        data[`${parentId}_subdivision_index`] = result.index;
        currentRemaining = result.remaining;
      }
    }

    return { data, remaining: currentRemaining };
  }

  processNamedSequence(units: any[], remaining: number, context: CalendarData, parentId: string) {
    if (remaining >= 0) {
      let accumulated = 0;

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const duration = this.resolveDuration(unit, context, parentId);

        if (accumulated + duration > remaining) {
          return { name: unit.name, index: i, remaining: remaining - accumulated };
        }

        accumulated += duration;
      }

      return {
        name: units[units.length - 1].name,
        index: units.length - 1,
        remaining: remaining - accumulated
      };
    } else {
      let accumulated = 0;

      for (let i = units.length - 1; i >= 0; i--) {
        const unit = units[i];
        const duration = this.resolveDuration(unit, context, parentId);

        accumulated -= duration;

        if (accumulated <= remaining) {
          return { name: unit.name, index: i, remaining: remaining - accumulated };
        }
      }

      return { name: units[0].name, index: 0, remaining: remaining - accumulated };
    }
  }

  resolveDuration(unit: any, context: CalendarData, parentId: string): number {
    const override = this.getOverride(unit, context[`${parentId}_index`]);
    if (override !== undefined) {
      return override;
    }
    if (unit.duration_ticks !== undefined) {
      return unit.duration_ticks;
    }
    if (unit.duration_fn) {
      return this.evaluateDurationFn(unit.duration_fn, context);
    }
    return 0;
  }

  evaluateDurationFn(durationFn: any, context: CalendarData): number {
    if (typeof durationFn === 'object' && durationFn.type === 'expression') {
      return this.evaluateExpression(durationFn, context);
    }

    if (durationFn.type === 'conditional') {
      const variable = context[durationFn.variable] || 0;

      for (const condition of durationFn.conditions) {
        if (condition.default) {
          return condition.duration_ticks;
        }

        if (this.evaluateCondition(condition.if, variable, context)) {
          return condition.duration_ticks;
        }
      }
    }

    return 0;
  }

  evaluateCondition(condition: any, value: number, context: CalendarData): boolean {
    if (condition.type === 'function_call') {
      const args = this.resolveArguments(condition.args, value, context);
      return this.callFunction(this.functions[condition.function], args, context);
    }

    if (condition.type === 'modulo') {
      const val = this.resolveValue(condition.value, value, context);
      return (val % condition.divisor) === condition.equals;
    }

    if (condition.type === 'compare') {
      const left = this.resolveValue(condition.left, value, context);
      const right = this.resolveValue(condition.right, value, context);

      switch (condition.operator) {
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        case '==': return left === right;
        case '!=': return left !== right;
        default: return false;
      }
    }

    if (condition.type === 'and') {
      return condition.conditions.every((c: any) => this.evaluateCondition(c, value, context));
    }

    if (condition.type === 'or') {
      return condition.conditions.some((c: any) => this.evaluateCondition(c, value, context));
    }

    if (condition.type === 'not') {
      return !this.evaluateCondition(condition.condition, value, context);
    }

    return false;
  }

  evaluateExpression(expr: any, context: CalendarData) {
    if (expr.type === 'expression' && expr.operator === 'ternary') {
      const conditionResult = this.evaluateCondition(expr.condition, 0, context);
      return conditionResult ? expr.true_value : expr.false_value;
    }

    return 0;
  }

  resolveArguments(args: any[], defaultValue: number, context: CalendarData) {
    if (!args || args.length === 0) return [defaultValue];

    return args.map(arg => this.resolveValue(arg, defaultValue, context));
  }

  resolveValue(value: any, defaultValue: number, context: CalendarData): number {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'object') {
      if (value.type === 'variable') {
        return context[value.name] !== undefined ? context[value.name] : defaultValue;
      }

      if (value.type === 'add') {
        const left = this.resolveValue(value.left, defaultValue, context);
        const right = this.resolveValue(value.right, defaultValue, context);
        return left + right;
      }

      if (value.type === 'subtract') {
        const left = this.resolveValue(value.left, defaultValue, context);
        const right = this.resolveValue(value.right, defaultValue, context);
        return left - right;
      }
    }

    return defaultValue;
  }

  callFunction(functionDef: any, args: number[], context: CalendarData) {
    if (!functionDef) return false;

    if (functionDef.type === 'leap_year') {
      const year = args[0];

      for (const rule of functionDef.rules) {
        const val = this.resolveValue(rule.value, year, { ...context, year });

        if (rule.condition.type === 'modulo') {
          if ((val % rule.condition.divisor) === rule.condition.equals) {
            return rule.result;
          }
        }
      }

      return false;
    }

    if (functionDef.type === 'cycle_position') {
      const value = args[0];
      const cycleLength = functionDef.cycle_length;
      const position = ((value % cycleLength) + cycleLength) % cycleLength;
      return functionDef.positions.includes(position);
    }

    return false;
  }

  getSortedCycles(): any[] {
    return [...this.def.cycles].sort((a, b) => {
      const durationA = this.estimateCycleDuration(a);
      const durationB = this.estimateCycleDuration(b);
      return durationB - durationA;
    });
  }

  estimateCycleDuration(cycle: any): number {
    if (cycle.duration_ticks) {
      return cycle.duration_ticks;
    }
    if (cycle.estimated_duration_ticks) {
      return cycle.estimated_duration_ticks;
    }
    return 0;
  }

  formatCalendar(calendarData: CalendarData, format = 'full'): string {
    if (format === 'gregorian' && calendarData.year !== undefined) {
      const month = calendarData.year_subdivision || 'January';
      const day = (calendarData.day || 0) + 1;
      const year = (calendarData.year || 0);
      const hour = calendarData.hour || 0;
      const minute = calendarData.minute || 0;
      const second = calendarData.second || 0;

      return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    }

    return JSON.stringify(calendarData, null, 2);
  }

  // The smallest number of ticks this calendar can actually distinguish - i.e. its finest
  // fixed-duration cycle/subdivision. A timestamp that isn't a multiple of this will lose its
  // remainder on decode (there's no field to store it in), so calendarToTimestamp(timestampToCalendar(t))
  // is only guaranteed to equal t when t is already a multiple of the resolution.
  getResolution(): number {
    let min = Infinity;

    const visitUnit = (unit: any) => {
      if (unit.duration_ticks !== undefined) min = Math.min(min, unit.duration_ticks);
      if (unit.subdivisions) unit.subdivisions.forEach(visitSubdivision);
    };
    const visitSubdivision = (subdiv: any) => {
      if (subdiv.type === 'uniform' && subdiv.duration_ticks !== undefined) {
        min = Math.min(min, subdiv.duration_ticks);
      } else if (subdiv.type === 'named_sequence') {
        subdiv.units.forEach(visitUnit);
      }
    };

    (this.def.cycles || []).forEach(visitUnit);

    return Number.isFinite(min) ? min : 1;
  }
}

export const gregorianCalendar: CalendarDefinition = {
  "name": "Gregorian Calendar",
  "epoch": {
    "timestamp": 621672192000
  },
  "functions": {
    "is_leap_year": {
      "type": "leap_year",
      "rules": [
        {
          "condition": { "type": "modulo", "divisor": 400, "equals": 0 },
          "value": { "type": "variable", "name": "year_index" },
          "result": true
        },
        {
          "condition": { "type": "modulo", "divisor": 100, "equals": 0 },
          "value": { "type": "variable", "name": "year_index" },
          "result": false
        },
        {
          "condition": { "type": "modulo", "divisor": 4, "equals": 0 },
          "value": { "type": "variable", "name": "year_index" },
          "result": true
        }
      ]
    }
  },
  "cycles": [
    {
      "id": "year",
      "estimated_duration_ticks": 315360000,
      "duration_fn": {
        "type": "conditional",
        "variable": "year_index",
        "conditions": [
          {
            "if": {
              "type": "function_call",
              "function": "is_leap_year",
              "args": [{ "type": "variable", "name": "year_index" }]
            },
            "duration_ticks": 316224000
          },
          {
            "default": true,
            "duration_ticks": 315360000
          }
        ]
      },
      "subdivisions": [
        {
          "type": "named_sequence",
          "units": [
            { "name": "January", "duration_ticks": 26784000 },
            {
              "name": "February",
              "duration_fn": {
                "type": "expression",
                "operator": "ternary",
                "condition": {
                  "type": "function_call",
                  "function": "is_leap_year",
                  "args": [{ "type": "variable", "name": "year_index" }]
                },
                "true_value": 25056000,
                "false_value": 24192000
              }
            },
            { "name": "March", "duration_ticks": 26784000 },
            { "name": "April", "duration_ticks": 25920000 },
            { "name": "May", "duration_ticks": 26784000 },
            { "name": "June", "duration_ticks": 25920000 },
            { "name": "July", "duration_ticks": 26784000 },
            { "name": "August", "duration_ticks": 26784000 },
            { "name": "September", "duration_ticks": 25920000 },
            { "name": "October", "duration_ticks": 26784000 },
            { "name": "November", "duration_ticks": 25920000 },
            { "name": "December", "duration_ticks": 26784000 }
          ]
        }
      ]
    },
    { "id": "day", "duration_ticks": 864000 },
    { "id": "hour", "duration_ticks": 36000 },
    { "id": "minute", "duration_ticks": 600 },
    { "id": "second", "duration_ticks": 10 }
  ]
};

export const decimalCalendar: CalendarDefinition = {
  "name": "Decimal Calendar",
  "epoch": { "timestamp": 621672192000 },
  "cycles": [
    { "id": "megaday", "duration_ticks": 864000000000 },
    { "id": "kiloday", "duration_ticks": 864000000 },
    { "id": "day", "duration_ticks": 864000 },
    { "id": "milliday", "duration_ticks": 864 }
  ]
};

// Showcases independent cycles, exceptions, and comparison-based conditionals
// (see src/lib/calendars.js for the full write-up of the lore/reasoning behind this one).
export const thessianCalendar: CalendarDefinition = (() => {
  const isLeapYear = {
    type: "function_call",
    function: "is_leap_year",
    args: [{ type: "variable", name: "year_index" }]
  };
  const isReformEra = {
    type: "compare",
    operator: ">=",
    left: { type: "variable", name: "year_index" },
    right: 1000
  };

  const def: CalendarDefinition = {
    name: "Thessian Calendar",
    epoch: { timestamp: 0 },
    functions: {
      is_leap_year: {
        type: "leap_year",
        rules: [
          { condition: { type: "modulo", divisor: 5, equals: 0 }, value: { type: "variable", name: "year_index" }, result: true },
        ]
      }
    },
    cycles: [
      {
        id: "year",
        estimated_duration_ticks: 315360000,
        duration_fn: {
          type: "conditional",
          variable: "year_index",
          conditions: [
            { if: { type: "and", conditions: [isLeapYear, isReformEra] }, duration_ticks: 319680000 },
            { if: { type: "and", conditions: [isLeapYear, { type: "not", condition: isReformEra }] }, duration_ticks: 315360000 },
            { if: { type: "and", conditions: [{ type: "not", condition: isLeapYear }, isReformEra] }, duration_ticks: 315360000 },
            { default: true, duration_ticks: 311040000 }
          ]
        },
        subdivisions: [
          {
            type: "named_sequence",
            units: [
              {
                name: "Frostmoon",
                duration_fn: {
                  type: "conditional",
                  variable: "year_index",
                  conditions: [
                    { if: { type: "and", conditions: [isLeapYear, isReformEra] }, duration_ticks: 86400000 },
                    { if: { type: "and", conditions: [isLeapYear, { type: "not", condition: isReformEra }] }, duration_ticks: 82080000 },
                    { if: { type: "and", conditions: [{ type: "not", condition: isLeapYear }, isReformEra] }, duration_ticks: 82080000 },
                    { default: true, duration_ticks: 77760000 }
                  ]
                },
                exceptions: { 1452: 103680000 }
              },
              { name: "Bloomtide", duration_ticks: 77760000 },
              { name: "Suncrest", duration_ticks: 77760000 },
              { name: "Harvestwane", duration_ticks: 77760000 },
            ]
          }
        ]
      },
      { id: "day", duration_ticks: 864000 },
    ],
    independent_cycles: [
      { id: "weekday", duration_ticks: 864000, period: 6, names: ["Emberday", "Stoneday", "Windday", "Tideday", "Duskday", "Starday"] }
    ]
  };
  def.cycles[0].exceptions = { 1452: 336960000 };
  return def;
})();
