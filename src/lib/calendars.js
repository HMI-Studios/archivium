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
    
    return result;
  }

  calendarToTimestamp(calendarData) {
    let timestamp = -this.def.epoch.timestamp;
    const cycles = this.getSortedCycles();
    
    for (const cycle of cycles) {
      const count = calendarData[cycle.id] || 0;
      
      if (cycle.duration_fn) {
        if (count >= 0) {
          for (let i = 0; i < count; i++) {
            const duration = this.evaluateDurationFn(cycle.duration_fn, {
              ...calendarData,
              [`${cycle.id}_index`]: i
            });
            timestamp += duration;
          }
        } else {
          for (let i = -1; i >= count; i--) {
            const duration = this.evaluateDurationFn(cycle.duration_fn, {
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
          calendarData,
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
            const duration = this.resolveDuration(unit, calendarData);
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
        const duration = this.evaluateDurationFn(cycle.duration_fn, {
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
        const duration = this.evaluateDurationFn(cycle.duration_fn, {
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
        const result = this.processNamedSequence(subdiv.units, currentRemaining, context);
        data[`${parentId}_subdivision`] = result.name;
        data[`${parentId}_subdivision_index`] = result.index;
        currentRemaining = result.remaining;
      }
    }
    
    return { data, remaining: currentRemaining };
  }

  processNamedSequence(units, remaining, context) {
    if (remaining >= 0) {
      let accumulated = 0;
      
      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const duration = this.resolveDuration(unit, context);
        
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
        const duration = this.resolveDuration(unit, context);
        
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

  resolveDuration(unit, context) {
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
