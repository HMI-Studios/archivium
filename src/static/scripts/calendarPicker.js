if (!window.createElement) throw 'domUtils.js not loaded!';

(function() {
  function getYearValue() {
    const { Year } = this.time;
    if (Year % 4 === 0 && (Year % 100 !== 0 || Year % 400 === 0)) return 316224000;
    else return 315360000;
  }
  function getMonthValue() {
    const { Month } = this.time;
    if (Month === 2) return getYearValue.apply(this) === 316224000 ? (29 * 864000) : (28 * 864000);
    else if (Month === 4 || Month === 6 || Month === 9 || Month === 11) return 30 * 864000;
    else return 31 * 864000;
  }
  function nameMonth(month) {
    return {
      1: 'January',
      2: 'February',
      3: 'March',
      4: 'April',
      5: 'May',
      6: 'June',
      7: 'July',
      8: 'August',
      9: 'September',
      10: 'October',
      11: 'November',
      12: 'December',
    }[month];
  }
  function nameDay(day) {
    if (day % 10 === 1 && day % 100 !== 11) return `${day}st`;
    else if (day % 10 === 2 && day % 100 !== 12) return `${day}nd`;
    else if (day % 10 === 3 && day % 100 !== 13) return `${day}rd`;
    else return `${day}th`;
  }

  class CalendarPicker {
    constructor() {
      this.defaults = {
        Year: 0,
        Month: 1,
        Day: 1,
        Hour: 0,
        Minute: 0,
        Second: 0,
      };

      this.reset();

      this.evals = {
        Year: getYearValue.bind(this),
        Month: getMonthValue.bind(this),
        Day: () => 864000,
        Hour: () => 36000,
        Minute: () => 600,
        Second: () => 10,
      };

      this.names = {
        Year: v => v,
        Month: v => nameMonth(v),
        Day: v => nameDay(v),
        Hour: v => v,
        Minute: v => v,
        Second: v => v,
      };

      this.fields = [];
      this.inputs = {};
      for (const key in this.time) {
        const input = createElement('input', { attrs: { onchange: ({ target }) => { this.time[key] = Number(target.value) } } });
        this.fields.push(createElement('div', { children: [
          createElement('label', { attrs: { innerText: `${T(key)}: ` } }),
          input,
        ] }));
        this.inputs[key] = input;
      }
    }

    format() {
      const { Year, Month, Day, Hour, Minute } = this.time;
      return `${this.names.Month(Month)} ${this.names.Day(Day)} ${Year}, ${Hour}:${Minute < 10 ? '0' : ''}${Minute}`;
    }

    update() {
      for (const key in this.time) {
        this.inputs[key].value = this.time[key];
      }
    }

    reset() {
      this.time = { ...this.defaults };
    }

    setTime(abstime) {
      this.reset();
      let curTime = abstime;
      for (const key in this.time) {
        while (curTime >= this.evals[key]()) {
          curTime -= this.evals[key]();
          this.time[key] += 1;
        }
      }
      this.update();
    }

    getAbsTime() {
      let abstime = 0;
      for (const key in this.time) {
        while (this.time[key] > this.defaults[key]) {
          this.time[key] -= 1;
          abstime += this.evals[key]();
        }
      }
      this.setTime(abstime);

      return abstime;
    }
  }

  window.CalendarPicker = CalendarPicker;
})();
