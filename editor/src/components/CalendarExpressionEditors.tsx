import { createContext, useContext, useState } from 'react';
import type { CompareOp, Condition, Duration, Exception, Value } from '../lib/calendarBuilder';
import { COMPARE_OPS, newCondition } from '../lib/calendarBuilder';

// What the editors need to know about the calendar being edited.
export type BuilderContextValue = {
  functionNames: string[]; // for function_call conditions
  variables: string[]; // suggestions for variable names (a <datalist>, not a restriction)
};
export const BuilderContext = createContext<BuilderContextValue>({ functionNames: [], variables: [] });
export const VARIABLES_LIST_ID = 'calendar-builder-variables';

export function replaceAt<T>(arr: T[], i: number, item: T): T[] {
  const copy = arr.slice();
  copy[i] = item;
  return copy;
}
export function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, idx) => idx !== i);
}
export function moveAt<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = arr.slice();
  copy.splice(to, 0, copy.splice(from, 1)[0]);
  return copy;
}

// ---- Value ----

type ValueType = Value['type'];
const VALUE_LABELS: { [t in ValueType]: string } = { number: 'number', variable: 'variable', add: 'a + b', subtract: 'a − b' };

export function ValueEditor({ value, onChange }: { value: Value; onChange: (v: Value) => void }) {
  const ctx = useContext(BuilderContext);

  function changeType(type: ValueType) {
    if (type === value.type) return;
    if (type === 'number') onChange({ type: 'number', value: 0 });
    else if (type === 'variable') onChange({ type: 'variable', name: ctx.variables[0] ?? '' });
    else if (value.type === 'add' || value.type === 'subtract') onChange({ ...value, type });
    else onChange({ type, left: value, right: { type: 'number', value: 1 } }); // keep what was there as the left operand
  }

  return (
    <span style={styles.inline}>
      <select value={value.type} onChange={e => changeType(e.target.value as ValueType)}>
        {(Object.keys(VALUE_LABELS) as ValueType[]).map(t => <option key={t} value={t}>{VALUE_LABELS[t]}</option>)}
      </select>
      {value.type === 'number' && (
        <input style={styles.smallInput} type="number" value={value.value}
          onChange={e => onChange({ ...value, value: Number(e.target.value) })} />
      )}
      {value.type === 'variable' && (
        <input style={styles.input} list={VARIABLES_LIST_ID} value={value.name} spellCheck={false}
          onChange={e => onChange({ ...value, name: e.target.value })} />
      )}
      {(value.type === 'add' || value.type === 'subtract') && (
        <span style={styles.operands}>
          <ValueEditor value={value.left} onChange={left => onChange({ ...value, left })} />
          <span>{value.type === 'add' ? '+' : '−'}</span>
          <ValueEditor value={value.right} onChange={right => onChange({ ...value, right })} />
        </span>
      )}
    </span>
  );
}

// ---- Condition ----

type ConditionType = Condition['type'];
const CONDITION_LABELS: { [t in ConditionType]: string } = {
  function_call: 'function', modulo: 'modulo', compare: 'compare', and: 'all of (and)', or: 'any of (or)', not: 'not',
};

export function ConditionEditor({ condition, onChange, variable }: {
  condition: Condition;
  onChange: (c: Condition) => void;
  variable: string; // the surrounding duration's variable, used to seed new conditions
}) {
  const ctx = useContext(BuilderContext);

  function changeType(type: ConditionType) {
    if (type === condition.type) return;
    if ((type === 'and' || type === 'or') && (condition.type === 'and' || condition.type === 'or')) {
      onChange({ ...condition, type });
    } else if (type === 'and' || type === 'or') {
      onChange({ type, conditions: [condition] }); // wrap what was there
    } else if (type === 'not') {
      onChange({ type, condition });
    } else if (type === 'function_call') {
      // newCondition only yields a function_call when a function is defined; otherwise leave it unset
      const fresh = newCondition(ctx.functionNames, variable);
      onChange(fresh.type === 'function_call' ? fresh : { type, function: '', args: [{ type: 'variable', name: variable }] });
    } else if (type === 'modulo') {
      onChange({ type, value: null, divisor: 2, equals: 0 });
    } else {
      onChange({ type, operator: '>=', left: { type: 'variable', name: variable }, right: { type: 'number', value: 0 } });
    }
  }

  return (
    <div style={styles.condition}>
      <select value={condition.type} onChange={e => changeType(e.target.value as ConditionType)}>
        {(Object.keys(CONDITION_LABELS) as ConditionType[]).map(t => <option key={t} value={t}>{CONDITION_LABELS[t]}</option>)}
      </select>

      {condition.type === 'function_call' && <FunctionCallBody condition={condition} onChange={onChange} />}

      {condition.type === 'modulo' && (
        <span style={styles.inline}>
          <label style={styles.small}>
            <input type="checkbox" checked={condition.value !== null}
              onChange={e => onChange({ ...condition, value: e.target.checked ? { type: 'variable', name: variable } : null })} /> custom value
          </label>
          {condition.value
            ? <ValueEditor value={condition.value} onChange={value => onChange({ ...condition, value })} />
            : <span style={styles.note}>({variable || 'variable'})</span>}
          <span>%</span>
          <input style={styles.smallInput} type="number" value={condition.divisor}
            onChange={e => onChange({ ...condition, divisor: Number(e.target.value) })} />
          <span>==</span>
          <input style={styles.smallInput} type="number" value={condition.equals}
            onChange={e => onChange({ ...condition, equals: Number(e.target.value) })} />
        </span>
      )}

      {condition.type === 'compare' && (
        <span style={styles.inline}>
          <ValueEditor value={condition.left} onChange={left => onChange({ ...condition, left })} />
          <select value={condition.operator} onChange={e => onChange({ ...condition, operator: e.target.value as CompareOp })}>
            {COMPARE_OPS.map(op => <option key={op} value={op}>{op}</option>)}
          </select>
          <ValueEditor value={condition.right} onChange={right => onChange({ ...condition, right })} />
        </span>
      )}

      {(condition.type === 'and' || condition.type === 'or') && (
        <div style={styles.nested}>
          {condition.conditions.map((c, i) => (
            <div key={i} style={styles.row}>
              <ConditionEditor condition={c} variable={variable}
                onChange={next => onChange({ ...condition, conditions: replaceAt(condition.conditions, i, next) })} />
              <button title="Remove" onClick={() => onChange({ ...condition, conditions: removeAt(condition.conditions, i) })}>&times;</button>
            </div>
          ))}
          <button onClick={() => onChange({ ...condition, conditions: [...condition.conditions, newCondition(ctx.functionNames, variable)] })}>
            + Add condition
          </button>
        </div>
      )}

      {condition.type === 'not' && (
        <div style={styles.nested}>
          <ConditionEditor condition={condition.condition} variable={variable} onChange={c => onChange({ ...condition, condition: c })} />
        </div>
      )}
    </div>
  );
}

function FunctionCallBody({ condition, onChange }: {
  condition: Extract<Condition, { type: 'function_call' }>;
  onChange: (c: Condition) => void;
}) {
  const ctx = useContext(BuilderContext);
  const known = ctx.functionNames.includes(condition.function);

  return (
    <span style={styles.inline}>
      <select value={condition.function} onChange={e => onChange({ ...condition, function: e.target.value })}>
        {!known && <option value={condition.function}>{condition.function || '(none)'} (not defined)</option>}
        {ctx.functionNames.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <span>(</span>
      {condition.args.map((arg, i) => (
        <span key={i} style={styles.inline}>
          <ValueEditor value={arg} onChange={v => onChange({ ...condition, args: replaceAt(condition.args, i, v) })} />
          <button title="Remove argument" onClick={() => onChange({ ...condition, args: removeAt(condition.args, i) })}>&times;</button>
        </span>
      ))}
      <button onClick={() => onChange({ ...condition, args: [...condition.args, { type: 'variable', name: ctx.variables[0] ?? '' }] })}>+ arg</button>
      <span>)</span>
      {condition.args.length === 0 && <span style={styles.note}>no args = the conditional's variable</span>}
    </span>
  );
}

// ---- Duration ----

export function DurationEditor({ duration, onChange, variable }: {
  duration: Duration;
  onChange: (d: Duration) => void;
  variable: string; // e.g. "year_index": what a new conditional/condition reads from
}) {
  const ctx = useContext(BuilderContext);

  // Remember the "normal" length across kind changes so switching doesn't lose the number.
  const baseTicks = duration.kind === 'fixed' ? duration.ticks
    : duration.kind === 'ternary' ? duration.falseTicks
      : duration.defaultTicks ?? duration.branches[0]?.ticks ?? 0;

  function changeKind(kind: Duration['kind']) {
    if (kind === duration.kind) return;
    if (kind === 'fixed') onChange({ kind, ticks: baseTicks });
    else if (kind === 'ternary') onChange({ kind, condition: newCondition(ctx.functionNames, variable), trueTicks: baseTicks, falseTicks: baseTicks });
    else onChange({ kind, variable, branches: [], defaultTicks: baseTicks });
  }

  return (
    <div>
      <div style={styles.row}>
        <select value={duration.kind} onChange={e => changeKind(e.target.value as Duration['kind'])}>
          <option value="fixed">Fixed duration</option>
          <option value="conditional">Conditional (if / else-if / default)</option>
          <option value="ternary">If / else</option>
        </select>
        {duration.kind === 'fixed' && <TicksInput label="ticks" value={duration.ticks} onChange={ticks => onChange({ ...duration, ticks })} />}
      </div>

      {duration.kind === 'conditional' && (
        <div style={styles.nested}>
          <div style={styles.row}>
            <label style={styles.label}>variable</label>
            <input style={styles.input} list={VARIABLES_LIST_ID} value={duration.variable} spellCheck={false}
              onChange={e => onChange({ ...duration, variable: e.target.value })} />
            <span style={styles.note}>(used by conditions that don't name their own value)</span>
          </div>
          {duration.branches.map((b, i) => (
            <div key={i} style={styles.branch}>
              <div style={styles.row}>
                <strong>{i === 0 ? 'if' : 'else if'}</strong>
                <TicksInput label="→ ticks" value={b.ticks}
                  onChange={ticks => onChange({ ...duration, branches: replaceAt(duration.branches, i, { ...b, ticks }) })} />
                <button title="Earlier (checked first)" disabled={i === 0} onClick={() => onChange({ ...duration, branches: moveAt(duration.branches, i, i - 1) })}>&uarr;</button>
                <button title="Later" disabled={i === duration.branches.length - 1} onClick={() => onChange({ ...duration, branches: moveAt(duration.branches, i, i + 1) })}>&darr;</button>
                <button title="Remove branch" onClick={() => onChange({ ...duration, branches: removeAt(duration.branches, i) })}>&times;</button>
              </div>
              <ConditionEditor condition={b.condition} variable={duration.variable}
                onChange={condition => onChange({ ...duration, branches: replaceAt(duration.branches, i, { ...b, condition }) })} />
            </div>
          ))}
          <button onClick={() => onChange({ ...duration, branches: [...duration.branches, { condition: newCondition(ctx.functionNames, duration.variable), ticks: baseTicks }] })}>
            + Add branch
          </button>
          <div style={styles.row}>
            <label style={styles.small}>
              <input type="checkbox" checked={duration.defaultTicks !== null}
                onChange={e => onChange({ ...duration, defaultTicks: e.target.checked ? baseTicks : null })} /> else (default)
            </label>
            {duration.defaultTicks !== null && (
              <TicksInput label="→ ticks" value={duration.defaultTicks} onChange={defaultTicks => onChange({ ...duration, defaultTicks })} />
            )}
            {duration.defaultTicks === null && <span style={styles.note}>no default: evaluates to 0 if no branch matches</span>}
          </div>
        </div>
      )}

      {duration.kind === 'ternary' && (
        <div style={styles.nested}>
          <div style={styles.branch}>
            <div style={styles.row}>
              <strong>if</strong>
              <TicksInput label="→ ticks" value={duration.trueTicks} onChange={trueTicks => onChange({ ...duration, trueTicks })} />
            </div>
            <ConditionEditor condition={duration.condition} variable={variable} onChange={condition => onChange({ ...duration, condition })} />
          </div>
          <div style={styles.row}>
            <strong>else</strong>
            <TicksInput label="→ ticks" value={duration.falseTicks} onChange={falseTicks => onChange({ ...duration, falseTicks })} />
          </div>
        </div>
      )}
    </div>
  );
}

function TicksInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <span style={styles.inline}>
      <label style={styles.label}>{label}</label>
      <input style={styles.ticksInput} type="number" value={value} onChange={e => onChange(Number(e.target.value))} />
    </span>
  );
}

// ---- Exceptions ----

export function ExceptionsEditor({ exceptions, onChange, indexLabel }: {
  exceptions: Exception[];
  onChange: (e: Exception[]) => void;
  indexLabel: string; // e.g. "year"
}) {
  if (!exceptions.length) {
    return (
      <div style={styles.row}>
        <button onClick={() => onChange([{ index: 0, ticks: 0 }])}>+ Add exception</button>
        <span style={styles.note}>override the duration of one specific {indexLabel}</span>
      </div>
    );
  }
  return (
    <div style={styles.nested}>
      <strong>Exceptions</strong> <span style={styles.note}>(a specific {indexLabel} index uses this duration instead)</span>
      {exceptions.map((ex, i) => (
        <div key={i} style={styles.row}>
          <label style={styles.label}>{indexLabel} index</label>
          <input style={styles.smallInput} type="number" value={ex.index}
            onChange={e => onChange(replaceAt(exceptions, i, { ...ex, index: Math.trunc(Number(e.target.value)) }))} />
          <TicksInput label="ticks" value={ex.ticks} onChange={ticks => onChange(replaceAt(exceptions, i, { ...ex, ticks }))} />
          <button title="Remove" onClick={() => onChange(removeAt(exceptions, i))}>&times;</button>
        </div>
      ))}
      <button onClick={() => onChange([...exceptions, { index: 0, ticks: 0 }])}>+ Add exception</button>
    </div>
  );
}

// ---- Misc ----

// Comma-separated list of numbers. Keeps its own text so typing a trailing comma isn't eaten.
export function NumberListInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const parse = (s: string) => s.split(',').map(t => t.trim()).filter(t => t !== '').map(Number).filter(Number.isFinite);
  const [text, setText] = useState(() => value.join(', '));
  const inSync = JSON.stringify(parse(text)) === JSON.stringify(value);
  return (
    <input style={styles.input} value={inSync ? text : value.join(', ')}
      onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} />
  );
}

export const styles: { [key: string]: React.CSSProperties } = {
  row: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' },
  inline: { display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' },
  operands: { display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap', paddingLeft: '0.4rem', borderLeft: '2px solid #ddd' },
  label: { fontSize: '0.85rem', whiteSpace: 'nowrap' },
  small: { fontSize: '0.8rem', whiteSpace: 'nowrap' },
  input: { flex: 1, minWidth: 80, padding: '0.3rem', fontFamily: 'monospace' },
  smallInput: { width: 70, padding: '0.3rem', fontFamily: 'monospace' },
  ticksInput: { width: 130, padding: '0.3rem', fontFamily: 'monospace' },
  card: { border: '1px solid #ccc', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' },
  branch: { border: '1px solid #e2e2e2', borderRadius: 6, padding: '0.5rem', marginBottom: '0.4rem' },
  condition: { display: 'flex', gap: '0.4rem', alignItems: 'flex-start', flexWrap: 'wrap', flex: 1 },
  nested: { marginTop: '0.5rem', marginBottom: '0.4rem', paddingLeft: '0.75rem', borderLeft: '2px solid #ddd' },
  note: { color: '#888', fontSize: '0.85rem' },
};
