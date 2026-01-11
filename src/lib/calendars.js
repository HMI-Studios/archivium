// General Calendar System Implementation

class CalendarSystem {
  constructor(definition) {
    this.def = definition;
  }

  // Convert timestamp to calendar representation
  timestampToCalendar(timestamp) {
    const elapsed = timestamp + this.def.epoch.timestamp;
    const result = { timestamp, elapsed };
    
    // Process cycles from largest to smallest
    const cycles = this.getSortedCycles();
    let remaining = elapsed;
    
    for (const cycle of cycles) {
      const cycleResult = this.processCycle(cycle, remaining, result);
      result[cycle.id] = cycleResult.count;
      remaining = cycleResult.remaining;
      
      // Process subdivisions
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
    
    return result;
  }

  // Convert calendar representation back to timestamp
  calendarToTimestamp(calendarData) {
    let timestamp = -this.def.epoch.timestamp;
    const cycles = this.getSortedCycles();
    
    for (const cycle of cycles) {
      const count = calendarData[cycle.id] || 0;
      
      if (cycle.duration_fn) {
        // Variable duration - need to sum up individual cycles
        for (let i = 0; i < count; i++) {
          const duration = this.evaluateDurationFn(cycle.duration_fn, {
            ...calendarData,
            [`${cycle.id}_index`]: i
          });
          timestamp += duration;
        }
      } else if (cycle.duration_seconds) {
        timestamp += count * cycle.duration_seconds;
      }
      
      // Process subdivisions to add partial cycle time
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
        elapsed += count * subdiv.duration_seconds;
      } else if (subdiv.type === 'named_sequence') {
        // Find which unit we're in
        const subdivisionName = calendarData[`${parentId}_subdivision`];
        const subdivisionIndex = calendarData[`${parentId}_subdivision_index`];
        
        if (subdivisionIndex !== undefined) {
          // Sum up all complete units before the current one
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
      const duration = cycle.duration_seconds;
      
      // Handle negative remainders properly with floor division
      let count, remainder;
      if (remaining >= 0) {
        count = Math.floor(remaining / duration);
        remainder = remaining % duration;
      } else {
        // For negative values, we need to ensure the remainder is positive
        count = Math.floor(remaining / duration);
        remainder = remaining - (count * duration);
        
        // If remainder is negative, borrow from count
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
      // Positive: iterate forward through cycles
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
      // Negative: iterate backward through cycles
      while (true) {
        count--;
        const duration = this.evaluateDurationFn(cycle.duration_fn, {
          ...context,
          [`${cycle.id}_index`]: count
        });
        
        if (accumulated - duration < remaining) {
          // We've gone too far back, step forward one
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
        const duration = subdiv.duration_seconds;
        
        // Handle negative remainders
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
      // Forward iteration for positive remainders
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
      
      // If we've gone through all units, return the last one
      return {
        name: units[units.length - 1].name,
        index: units.length - 1,
        remaining: remaining - accumulated
      };
    } else {
      // Backward iteration for negative remainders
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
      
      // Return first unit if we've exhausted the list
      return {
        name: units[0].name,
        index: 0,
        remaining: remaining - accumulated
      };
    }
  }

  resolveDuration(unit, context) {
    if (unit.duration_seconds !== undefined) {
      return unit.duration_seconds;
    }
    if (unit.duration_fn) {
      return this.evaluateDurationFn(unit.duration_fn, context);
    }
    return 0;
  }

  evaluateDurationFn(durationFn, context) {
    if (typeof durationFn === 'string') {
      // Simple expression evaluation (e.g., "is_leap_year ? 2505600 : 2419200")
      return this.evaluateExpression(durationFn, context);
    }
    
    if (durationFn.type === 'conditional') {
      const variable = context[durationFn.variable] || 0;
      
      for (const condition of durationFn.conditions) {
        if (condition.default) {
          return condition.duration_seconds;
        }
        
        if (this.evaluateCondition(condition.if, variable, context)) {
          return condition.duration_seconds;
        }
      }
    }
    
    return 0;
  }

  evaluateCondition(conditionStr, value, context) {
    // Handle leap year function calls
    if (conditionStr.includes('is_leap_year')) {
      const match = conditionStr.match(/is_leap_year\(([^)]+)\)/);
      if (match) {
        const yearExpr = match[1].trim();
        let year = value;
        
        // Handle expressions like "year_index + n"
        if (yearExpr.includes('+')) {
          const parts = yearExpr.split('+');
          const base = parseInt(parts[1].trim());
          year = value + base;
        }
        
        return this.isLeapYear(year);
      }
    }
    
    // Simple condition evaluator for modulo operations
    // Format: "year % 400 == 0"
    const match = conditionStr.match(/(\w+)\s*%\s*(\d+)\s*==\s*(\d+)/);
    if (match) {
      const divisor = parseInt(match[2]);
      const expected = parseInt(match[3]);
      return (value % divisor) === expected;
    }
    return false;
  }

  evaluateExpression(expr, context) {
    // Handle leap year conditionals
    if (expr.includes('is_leap_year')) {
      const year = this.getYearFromContext(context);
      const isLeap = this.isLeapYear(year);
      const parts = expr.split('?');
      if (parts.length === 2) {
        const [truePart, falsePart] = parts[1].split(':');
        return isLeap ? parseInt(truePart.trim()) : parseInt(falsePart.trim());
      }
    }
    return parseInt(expr);
  }

  getYearFromContext(context) {
    // Calculate actual year from year index
    const yearIndex = context.year_index !== undefined ? context.year_index : (context.year || 0);
    return yearIndex;
  }

  isLeapYear(year) {
    if (year % 400 === 0) return true;
    if (year % 100 === 0) return false;
    if (year % 4 === 0) return true;
    return false;
  }

  getSortedCycles() {
    // Sort cycles by estimated duration (largest first)
    return [...this.def.cycles].sort((a, b) => {
      const durationA = this.estimateCycleDuration(a);
      const durationB = this.estimateCycleDuration(b);
      return durationB - durationA;
    });
  }

  estimateCycleDuration(cycle) {
    if (cycle.duration_seconds) {
      return cycle.duration_seconds;
    }
    // For variable cycles, use a heuristic
    if (cycle.id === 'year') return 31557600; // Average year
    if (cycle.id === '400year') return 12622780800;
    return 0;
  }

  // Utility: Format calendar data as human-readable string
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

// Example: Gregorian Calendar Definition
const gregorianCalendar = {
  name: "Gregorian Calendar",
  epoch: {
    // timestamp: 62167219200,
    timestamp: 0,
  },
  cycles: [
    {
      id: "year",
      duration_fn: {
        type: "conditional",
        variable: "year_index",
        conditions: [
          { if: "is_leap_year(year_index)", duration_seconds: 31622400 }, // 366 days
          { default: true, duration_seconds: 31536000 } // 365 days
        ]
      },
      subdivisions: [
        {
          type: "named_sequence",
          units: [
            { name: "January", duration_seconds: 2678400 }, // 31 days
            { name: "February", duration_fn: "is_leap_year ? 2505600 : 2419200" }, // 29 or 28 days
            { name: "March", duration_seconds: 2678400 },
            { name: "April", duration_seconds: 2592000 }, // 30 days
            { name: "May", duration_seconds: 2678400 },
            { name: "June", duration_seconds: 2592000 },
            { name: "July", duration_seconds: 2678400 },
            { name: "August", duration_seconds: 2678400 },
            { name: "September", duration_seconds: 2592000 },
            { name: "October", duration_seconds: 2678400 },
            { name: "November", duration_seconds: 2592000 },
            { name: "December", duration_seconds: 2678400 }
          ]
        }
      ]
    },
    {
      id: "day",
      duration_seconds: 86400,
    },
    {
      id: "hour",
      duration_seconds: 3600,
    },
    {
      id: "minute",
      duration_seconds: 60,
    },
    {
      id: "second",
      duration_seconds: 1,
    },
  ]
};

// Example: Decimal Calendar
const decimalCalendar = {
  name: "Decimal Calendar",
  epoch: {
    timestamp: 0,
  },
  cycles: [
    {
      id: "megaday",
      duration_seconds: 86400000, // 1000 days
      subdivisions: [
        { type: "uniform", id: "kiloday", count: 1000, duration_seconds: 86400 }
      ]
    },
    {
      id: "kiloday",
      duration_seconds: 86400,
      subdivisions: [
        { type: "uniform", id: "centiday", count: 100, duration_seconds: 864 }
      ]
    },
    {
      id: "centiday",
      duration_seconds: 864,
      subdivisions: [
        { type: "uniform", id: "deciday", count: 10, duration_seconds: 86.4 }
      ]
    }
  ]
};

// Usage Examples
console.log("=== Gregorian Calendar ===");
const greg = new CalendarSystem(gregorianCalendar);

// Current time
const now = Math.floor(Date.now() / 1000);
console.log("Current timestamp:", now);
console.log("Calendar representation:", greg.timestampToCalendar(now));
console.log("Formatted:", greg.formatCalendar(greg.timestampToCalendar(now), 'gregorian'));

// Specific date: 2024-03-15 14:30:00 (2024 is a leap year)
const specificDate = Math.floor(new Date('2024-03-15T14:30:00Z').getTime() / 1000);
console.log("\n2024-03-15 14:30:00 UTC (leap year):");
console.log("Calendar:", greg.timestampToCalendar(specificDate));

// Test leap year date: 2024-02-29 (leap day)
const leapDay = Math.floor(new Date('2024-02-29T12:00:00Z').getTime() / 1000);
console.log("\n2024-02-29 12:00:00 UTC (leap day):");
const leapDayCalendar = greg.timestampToCalendar(leapDay);
console.log("Calendar:", leapDayCalendar);
console.log("Formatted:", greg.formatCalendar(leapDayCalendar, 'gregorian'));

// Test non-leap year: 2023-02-28
const nonLeapYear = Math.floor(new Date('2023-02-28T12:00:00Z').getTime() / 1000);
console.log("\n2023-02-28 12:00:00 UTC (non-leap year):");
const nonLeapCalendar = greg.timestampToCalendar(nonLeapYear);
console.log("Calendar:", nonLeapCalendar);
console.log("Formatted:", greg.formatCalendar(nonLeapCalendar, 'gregorian'));

// Test century year that IS a leap year: 2000-02-29
const year2000 = Math.floor(new Date('2000-02-29T12:00:00Z').getTime() / 1000);
console.log("\n2000-02-29 12:00:00 UTC (divisible by 400, IS leap):");
const year2000Calendar = greg.timestampToCalendar(year2000);
console.log("Calendar:", year2000Calendar);
console.log("Is leap year 2000?", greg.isLeapYear(2000));

console.log("\n=== Decimal Calendar ===");
const decimal = new CalendarSystem(decimalCalendar);
console.log("Current time in decimal:", decimal.timestampToCalendar(now));

// Test round-trip conversion
console.log("\n=== Round-trip Test ===");
const original = 1234567890;
const calRep = greg.timestampToCalendar(original);
const converted = greg.calendarToTimestamp(calRep);
console.log("Original timestamp:", original);
console.log("Calendar representation:", calRep);
console.log("Converted back:", converted);
console.log("Difference:", converted - original, "seconds");
console.log("Match:", Math.abs(converted - original) < 60); // Allow small rounding

// Test round-trip with leap day
console.log("\n=== Leap Day Round-trip Test ===");
const leapDayOriginal = Math.floor(new Date('2024-02-29T12:00:00Z').getTime() / 1000);
const leapDayRep = greg.timestampToCalendar(leapDayOriginal);
console.log("Original leap day timestamp:", leapDayOriginal);
console.log("Calendar representation:", leapDayRep);
const leapDayConverted = greg.calendarToTimestamp(leapDayRep);
console.log("Converted back:", leapDayConverted);
console.log("Difference:", leapDayConverted - leapDayOriginal, "seconds");

// Test round-trip with different months
console.log("\n=== Different Month Tests ===");
const testDates = [
  '2024-01-15T10:30:00Z',
  '2024-03-01T00:00:00Z',
  '2024-06-30T23:59:59Z',
  '2024-12-31T18:45:30Z'
];

testDates.forEach(dateStr => {
  const ts = Math.floor(new Date(dateStr).getTime() / 1000);
  const cal = greg.timestampToCalendar(ts);
  const back = greg.calendarToTimestamp(cal);
  console.log(`${dateStr}: diff = ${back - ts} seconds, month = ${cal.year_subdivision}`);
});

// Additional leap year tests
console.log("\n=== Leap Year Tests ===");
console.log("2000 is leap?", greg.isLeapYear(2000), "(YES - divisible by 400)");
console.log("1900 is leap?", greg.isLeapYear(1900), "(NO - divisible by 100 but not 400)");
console.log("2024 is leap?", greg.isLeapYear(2024), "(YES - divisible by 4)");
console.log("2023 is leap?", greg.isLeapYear(2023), "(NO - not divisible by 4)");

// Negative timestamp tests
console.log("\n=== Negative Timestamp Tests (BCE dates) ===");

// 1969-12-31 23:00:00 (1 hour before epoch)
const oneHourBefore = -3600;
console.log("\n1 hour before epoch:");
const oneHourCal = greg.timestampToCalendar(oneHourBefore);
console.log("Calendar:", oneHourCal);
console.log("Formatted:", greg.formatCalendar(oneHourCal, 'gregorian'));

// 1969-06-15 (several months before epoch)
const juneNineteenSixtyNine = Math.floor(new Date('1969-06-15T12:00:00Z').getTime() / 1000);
console.log("\n1969-06-15 12:00:00:");
const june69Cal = greg.timestampToCalendar(juneNineteenSixtyNine);
console.log("Calendar:", june69Cal);
console.log("Month:", june69Cal.year_subdivision, "Day:", june69Cal.day, "Hour:", june69Cal.hour);

// 1960-01-01 (10 years before epoch)
const nineteenSixty = Math.floor(new Date('1960-01-01T00:00:00Z').getTime() / 1000);
console.log("\n1960-01-01 00:00:00:");
const sixtysCal = greg.timestampToCalendar(nineteenSixty);
console.log("Calendar:", sixtysCal);
console.log("Year:", sixtysCal.year + 1970, "Month:", sixtysCal.year_subdivision);

// Test round-trip with negative timestamps
console.log("\n=== Negative Timestamp Round-trip ===");
const negativeTests = [oneHourBefore, juneNineteenSixtyNine, nineteenSixty];
negativeTests.forEach(ts => {
  const cal = greg.timestampToCalendar(ts);
  const back = greg.calendarToTimestamp(cal);
  const date = new Date(ts * 1000).toISOString();
  console.log(`${date}: diff = ${back - ts} seconds`);
});
