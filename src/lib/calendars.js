class CalendarSystem {
  constructor(definition) {
    this.def = definition;
    this.functions = definition.functions || {};
  }

  timestampToCalendar(timestamp) {
    const elapsed = timestamp + this.def.epoch.timestamp;
    const result = { timestamp, elapsed };

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

  processIndependentCycle(cycle, elapsed) {
    const unitCount = Math.floor(elapsed / cycle.duration_ticks);
    const position = ((unitCount % cycle.period) + cycle.period) % cycle.period;
    return cycle.names ? cycle.names[position] : position;
  }

  getOverride(source, index) {
    if (!source || !source.exceptions || index === undefined) return undefined;
    return source.exceptions[index];
  }

  calendarToTimestamp(calendarData) {
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

  calculateSubdivisionTime(subdivisions, calendarData, parentId) {
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

  processCycle(cycle, remaining, context) {
    if (cycle.duration_fn) {
      return this.countVariableCycles(cycle, remaining, context);
    } else {
      const duration = cycle.duration_ticks;

      let count, remainder;
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

      return {
        count,
        remaining: remainder
      };
    }
  }

  countVariableCycles(cycle, remaining, context) {
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

    return {
      count,
      remaining: remaining - accumulated
    };
  }

  processSubdivisions(subdivisions, remaining, context, parentId) {
    const data = {};
    let currentRemaining = remaining;

    for (const subdiv of subdivisions) {
      if (subdiv.type === 'uniform') {
        const duration = subdiv.duration_ticks;

        let count, remainder;
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

  processNamedSequence(units, remaining, context, parentId) {
    if (remaining >= 0) {
      let accumulated = 0;

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const duration = this.resolveDuration(unit, context, parentId);

        if (accumulated + duration > remaining) {
          return {
            name: unit.name,
            index: i,
            remaining: remaining - accumulated
          };
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
          return {
            name: unit.name,
            index: i,
            remaining: remaining - accumulated
          };
        }
      }

      return {
        name: units[0].name,
        index: 0,
        remaining: remaining - accumulated
      };
    }
  }

  resolveDuration(unit, context, parentId) {
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

  evaluateDurationFn(durationFn, context) {
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

  evaluateCondition(condition, value, context) {
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
      return condition.conditions.every(c => this.evaluateCondition(c, value, context));
    }

    if (condition.type === 'or') {
      return condition.conditions.some(c => this.evaluateCondition(c, value, context));
    }

    if (condition.type === 'not') {
      return !this.evaluateCondition(condition.condition, value, context);
    }

    return false;
  }

  evaluateExpression(expr, context) {
    if (expr.type === 'expression' && expr.operator === 'ternary') {
      const conditionResult = this.evaluateCondition(expr.condition, 0, context);
      return conditionResult ? expr.true_value : expr.false_value;
    }

    return 0;
  }

  resolveArguments(args, defaultValue, context) {
    if (!args || args.length === 0) return [defaultValue];

    return args.map(arg => this.resolveValue(arg, defaultValue, context));
  }

  resolveValue(value, defaultValue, context) {
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

  callFunction(functionDef, args, context) {
    if (functionDef.type === 'leap_year') {
      const year = args[0];

      // Apply all rules in order
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

  getSortedCycles() {
    return [...this.def.cycles].sort((a, b) => {
      const durationA = this.estimateCycleDuration(a);
      const durationB = this.estimateCycleDuration(b);
      return durationB - durationA;
    });
  }

  estimateCycleDuration(cycle) {
    if (cycle.duration_ticks) {
      return cycle.duration_ticks;
    }
    if (cycle.estimated_duration_ticks) {
      return cycle.estimated_duration_ticks; // TODO
    }
    return 0;
  }

  formatCalendar(calendarData, format = 'full') {
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
}

const gregorianCalendar = {
  "name": "Gregorian Calendar",
  "epoch": {
    // "timestamp": 0,
    "timestamp": 621672192000,
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
    {
      "id": "day",
      "duration_ticks": 864000
    },
    {
      "id": "hour",
      "duration_ticks": 36000
    },
    {
      "id": "minute",
      "duration_ticks": 600
    },
    {
      "id": "second",
      "duration_ticks": 10
    }
  ]
};

// Example: Decimal Calendar
const decimalCalendar = {
  name: "Decimal Calendar",
  epoch: {
    timestamp: 621672192000,
  },
  cycles: [
    {
      id: "megaday",
      duration_ticks: 864000000000,
    },
    {
      id: "kiloday",
      duration_ticks: 864000000,
    },
    {
      id: "day",
      duration_ticks: 864000,
    },
    {
      id: "milliday",
      duration_ticks: 864,
    },
  ]
};

// Usage Examples
console.log("=== Gregorian Calendar (Pure JSON) ===");
const greg = new CalendarSystem(gregorianCalendar);

const now = Math.floor(Date.now() / 100);
console.log("Current timestamp:", now);
console.log("Calendar representation:", greg.timestampToCalendar(now));
console.log("Formatted:", greg.formatCalendar(greg.timestampToCalendar(now), 'gregorian'));

// Test leap years
const leapDay = Math.floor(new Date('2024-02-29T12:00:00Z').getTime() / 100);
console.log("\n2024-02-29 12:00:00 UTC (leap day):");
const leapDayCalendar = greg.timestampToCalendar(leapDay);
console.log("Calendar:", leapDayCalendar);
console.log("Formatted:", greg.formatCalendar(leapDayCalendar, 'gregorian'));

// Test round-trip
console.log("\n=== Round-trip Test ===");
const testDates = [
  '2024-01-15T10:30:00Z',
  '2024-02-29T12:00:00Z',
  '2000-02-29T12:00:00Z',
  '1900-03-01T00:00:00Z'
];

testDates.forEach(dateStr => {
  const ts = Math.floor(new Date(dateStr).getTime() / 100);
  const cal = greg.timestampToCalendar(ts);
  const back = greg.calendarToTimestamp(cal);
  console.log(`${dateStr}: diff = ${back - ts} ticks (calculated as ${greg.formatCalendar(cal, 'gregorian')})`);
});

// Demonstrate JSON serialization
console.log("\n=== JSON Serialization ===");
const serialized = JSON.stringify(gregorianCalendar, null, 2);
console.log("Calendar serialized to JSON (first 500 chars):");
console.log(serialized.substring(0, 500) + "...");

// Deserialize and use
const deserialized = JSON.parse(serialized);
const greg2 = new CalendarSystem(deserialized);
const testCal = greg2.timestampToCalendar(now);
console.log("\nDeserialized calendar works:", testCal.year, testCal.year_subdivision);

// Decimal Calendar Example
console.log("\n=== Decimal Calendar (Pure JSON) ===");
const decimal = new CalendarSystem(decimalCalendar);
const decimalNow = decimal.timestampToCalendar(now);
console.log("Current time in Decimal calendar:", decimalNow);

// Thessian Calendar: showcases independent cycles, exceptions, and comparison conditions.
//
// Lore: the Thessian empire kept a 360-day year (4 seasons of 90 days) until its
// calendar reform in year 1000, after which the year was extended to 365 days.
// Every 5th year is a leap year, adding 5 more days regardless of era. All of the
// extra days (from leap years and/or the reform) land in Frostmoon, the first season.
// In year 1452, "The Long Winter" added an extra 25 days to Frostmoon by decree -
// an irregular, one-off exception that doesn't fit any formula.
// Independently of all that, a 6-day Thessian week ticks on regardless of season/year.
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

const thessianCalendar = {
  name: "Thessian Calendar",
  epoch: {
    timestamp: 0,
  },
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
          { if: { type: "and", conditions: [isLeapYear, isReformEra] }, duration_ticks: 319680000 }, // 370 days
          { if: { type: "and", conditions: [isLeapYear, { type: "not", condition: isReformEra }] }, duration_ticks: 315360000 }, // 365 days
          { if: { type: "and", conditions: [{ type: "not", condition: isLeapYear }, isReformEra] }, duration_ticks: 315360000 }, // 365 days
          { default: true, duration_ticks: 311040000 } // 360 days
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
                  { if: { type: "and", conditions: [isLeapYear, isReformEra] }, duration_ticks: 86400000 }, // 100 days
                  { if: { type: "and", conditions: [isLeapYear, { type: "not", condition: isReformEra }] }, duration_ticks: 82080000 }, // 95 days
                  { if: { type: "and", conditions: [{ type: "not", condition: isLeapYear }, isReformEra] }, duration_ticks: 82080000 }, // 95 days
                  { default: true, duration_ticks: 77760000 } // 90 days
                ]
              },
              exceptions: { 1452: 103680000 } // The Long Winter of 1452: 120 days instead of the usual 95
            },
            { name: "Bloomtide", duration_ticks: 77760000 }, // 90 days
            { name: "Suncrest", duration_ticks: 77760000 }, // 90 days
            { name: "Harvestwane", duration_ticks: 77760000 }, // 90 days
          ]
        }
      ]
    },
    {
      id: "day",
      duration_ticks: 864000
    },
  ],
  independent_cycles: [
    {
      id: "weekday",
      duration_ticks: 864000,
      period: 6,
      names: ["Emberday", "Stoneday", "Windday", "Tideday", "Duskday", "Starday"]
    }
  ]
};

// Note: the year cycle's exception must stay consistent with the sum of its
// subdivisions' exceptions (here, both add exactly 25 extra days to 1452) - the
// cycle's total duration and its subdivisions' total must always agree, or dates
// near the boundary between affected and unaffected years will be miscomputed.
thessianCalendar.cycles[0].exceptions = { 1452: 336960000 }; // 390 days (365 + 25 from the Long Winter)

console.log("\n=== Thessian Calendar (independent cycles, exceptions, comparisons) ===");

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${message} (expected ${expected}, got ${actual})`);
  }
  console.log(`PASS: ${message}`);
}

const thessian = new CalendarSystem(thessianCalendar);

function tsFor(days) {
  // days is ticks-from-epoch expressed in whole days (1 day = 864000 ticks)
  return days * 864000;
}

// Compute cumulative offsets programmatically instead of by hand, to avoid arithmetic mistakes,
// then verify the library reproduces the same structure and round-trips exactly.
function formulaYearLength(yearIndex) {
  const leap = yearIndex % 5 === 0;
  const reform = yearIndex >= 1000;
  if (leap && reform) return 370;
  if (leap && !reform) return 365;
  if (!leap && reform) return 365;
  return 360;
}

function yearLength(yearIndex) {
  const exceptionTicks = thessianCalendar.cycles[0].exceptions[yearIndex];
  return exceptionTicks !== undefined ? exceptionTicks / 864000 : formulaYearLength(yearIndex);
}

function cumulativeDaysBeforeYear(yearIndex) {
  let total = 0;
  if (yearIndex >= 0) {
    for (let y = 0; y < yearIndex; y++) total += yearLength(y);
  } else {
    for (let y = -1; y >= yearIndex; y--) total -= yearLength(y);
  }
  return total;
}

// Year 3 (pre-reform, non-leap: 3 % 5 !== 0): first day of Bloomtide is day 90 of the year.
{
  const dayInYear = 90; // 0-indexed day-of-year where Bloomtide begins
  const ts = tsFor(cumulativeDaysBeforeYear(3) + dayInYear);
  const cal = thessian.timestampToCalendar(ts);
  assertEqual(cal.year, 3, "year 3, start of Bloomtide: year");
  assertEqual(cal.year_subdivision, "Bloomtide", "year 3, start of Bloomtide: season");
  assertEqual(thessian.calendarToTimestamp(cal), ts, "year 3, start of Bloomtide: round-trip");
}

// Year 5 (pre-reform, leap: 5 % 5 === 0): Frostmoon is 95 days, so day 94 is still Frostmoon, day 95 is Bloomtide.
{
  const tsLastFrostmoonDay = tsFor(cumulativeDaysBeforeYear(5) + 94);
  const calLast = thessian.timestampToCalendar(tsLastFrostmoonDay);
  assertEqual(calLast.year_subdivision, "Frostmoon", "year 5 (leap), day 94: still Frostmoon");

  const tsFirstBloomtideDay = tsFor(cumulativeDaysBeforeYear(5) + 95);
  const calFirst = thessian.timestampToCalendar(tsFirstBloomtideDay);
  assertEqual(calFirst.year_subdivision, "Bloomtide", "year 5 (leap), day 95: Bloomtide begins");
  assertEqual(thessian.calendarToTimestamp(calFirst), tsFirstBloomtideDay, "year 5 (leap), day 95: round-trip");
}

// Year 1000 (post-reform, non-leap: 1000 % 5 === 0 -> actually leap; use 1001 for non-leap post-reform)
{
  assertEqual(yearLength(1001), 365, "sanity: year 1001 is a non-leap, post-reform year");
  const ts = tsFor(cumulativeDaysBeforeYear(1001) + 94);
  const cal = thessian.timestampToCalendar(ts);
  assertEqual(cal.year, 1001, "year 1001, day 94: year");
  assertEqual(cal.year_subdivision, "Frostmoon", "year 1001, day 94: still in reformed (95-day) Frostmoon");
  assertEqual(thessian.calendarToTimestamp(cal), ts, "year 1001, day 94: round-trip");
}

// Year 1452: The Long Winter exception. Frostmoon is 120 days (not the formula's 95), and the
// year itself is 390 days (not the formula's 365) - both driven by exceptions, not duration_fn.
{
  assertEqual(formulaYearLength(1452), 365, "sanity: year 1452 would be 365 days by formula alone");
  const tsDay110 = tsFor(cumulativeDaysBeforeYear(1452) + 110);
  const calDay110 = thessian.timestampToCalendar(tsDay110);
  assertEqual(calDay110.year_subdivision, "Frostmoon", "Long Winter (1452), day 110: still Frostmoon thanks to the exception");
  assertEqual(thessian.calendarToTimestamp(calDay110), tsDay110, "Long Winter (1452), day 110: round-trip");

  const tsDay120 = tsFor(cumulativeDaysBeforeYear(1452) + 120);
  const calDay120 = thessian.timestampToCalendar(tsDay120);
  assertEqual(calDay120.year_subdivision, "Bloomtide", "Long Winter (1452), day 120: Frostmoon's exception ends, Bloomtide begins");
  assertEqual(thessian.calendarToTimestamp(calDay120), tsDay120, "Long Winter (1452), day 120: round-trip");

  // Year 1453 must start exactly where the extended year 1452 leaves off - proving the
  // cycle-level exception (390 days) and unit-level exception (Frostmoon +25 days) agree.
  const tsStartOf1453 = tsFor(cumulativeDaysBeforeYear(1453));
  const cal1453 = thessian.timestampToCalendar(tsStartOf1453);
  assertEqual(cal1453.year, 1453, "year after the Long Winter: year rolls over cleanly");
  assertEqual(cal1453.year_subdivision, "Frostmoon", "year after the Long Winter: starts fresh in Frostmoon");
  assertEqual(thessian.calendarToTimestamp(cal1453), tsStartOf1453, "year after the Long Winter: round-trip");
}

// Independent weekday cycle: ticks continuously regardless of season/year boundaries.
{
  const tsA = tsFor(cumulativeDaysBeforeYear(1452) + 110);
  const tsB = tsA + 6 * 864000; // exactly one full 6-day week later
  const calA = thessian.timestampToCalendar(tsA);
  const calB = thessian.timestampToCalendar(tsB);
  assertEqual(calA.weekday, calB.weekday, "weekday cycle: repeats every 6 days regardless of season boundaries");

  const names = thessianCalendar.independent_cycles[0].names;
  const idxA = names.indexOf(calA.weekday);
  const calNext = thessian.timestampToCalendar(tsA + 864000);
  assertEqual(calNext.weekday, names[(idxA + 1) % 6], "weekday cycle: advances by one name per day");
}

console.log("\nAll Thessian calendar assertions passed.");
