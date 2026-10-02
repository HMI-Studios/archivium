import { useMemo } from 'react';
import type { BuilderCycle, BuilderFunction, BuilderIndependentCycle, BuilderState, BuilderSubdivision, BuilderUnit, LeapRule } from '../lib/calendarBuilder';
import { autoEstimate, availableVariables, makeLeapStyle, renameFunction } from '../lib/calendarBuilder';
import CalendarFormatBuilder from './CalendarFormatBuilder';
import {
  BuilderContext, DurationEditor, ExceptionsEditor, NumberListInput, ValueEditor, VARIABLES_LIST_ID,
  moveAt, removeAt, replaceAt, styles,
} from './CalendarExpressionEditors';

type Props = {
  state: BuilderState;
  onChange: (state: BuilderState) => void;
  formatPreview?: string | null;
};

export default function CalendarBuilderForm({ state, onChange, formatPreview }: Props) {
  const ctx = useMemo(() => ({
    functionNames: state.functions.map(f => f.name),
    variables: availableVariables(state),
  }), [state]);

  function updateCycle(i: number, cycle: BuilderCycle) {
    onChange({ ...state, cycles: replaceAt(state.cycles, i, cycle) });
  }
  function addCycle() {
    onChange({
      ...state,
      cycles: [...state.cycles, {
        id: `cycle${state.cycles.length}`, duration: { kind: 'fixed', ticks: 1 }, estimatedTicks: null, exceptions: [], subdivisions: [],
      }],
    });
  }
  function removeCycle(i: number) {
    onChange({ ...state, cycles: removeAt(state.cycles, i) });
  }

  function updateIndependent(i: number, ic: BuilderIndependentCycle) {
    onChange({ ...state, independentCycles: replaceAt(state.independentCycles, i, ic) });
  }
  function addIndependent() {
    onChange({
      ...state,
      independentCycles: [...state.independentCycles, { id: `cycle${state.independentCycles.length}`, durationTicks: 1, period: 7, names: [] }],
    });
  }
  function removeIndependent(i: number) {
    onChange({ ...state, independentCycles: removeAt(state.independentCycles, i) });
  }

  function updateFunction(i: number, fn: BuilderFunction) {
    onChange({ ...state, functions: replaceAt(state.functions, i, fn) });
  }
  function addFunction(kind: BuilderFunction['kind']) {
    const name = `fn${state.functions.length + 1}`;
    const fn: BuilderFunction = kind === 'leap_year'
      ? { name, kind, rules: [{ divisor: 4, equals: 0, value: { type: 'variable', name: 'year_index' }, result: true }] }
      : { name, kind, cycleLength: 7, positions: [0] };
    onChange({ ...state, functions: [...state.functions, fn] });
  }

  return (
    <BuilderContext.Provider value={ctx}>
      <datalist id={VARIABLES_LIST_ID}>
        {ctx.variables.map(v => <option key={v} value={v} />)}
      </datalist>

      <div>
        <div style={styles.row}>
          <label style={styles.label}>Name</label>
          <input style={styles.input} value={state.name} onChange={e => onChange({ ...state, name: e.target.value })} />
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Epoch timestamp</label>
          <input style={styles.input} type="number" value={state.epochTimestamp}
            onChange={e => onChange({ ...state, epochTimestamp: Number(e.target.value) })} />
        </div>

        <h3>Functions</h3>
        <p style={styles.note}>Named tests (e.g. "is this a leap year?") that conditions below can call.</p>
        {state.functions.map((fn, i) => (
          <FunctionCard key={i} fn={fn} duplicate={state.functions.some((o, j) => j !== i && o.name === fn.name)}
            onChange={f => updateFunction(i, f)} onRename={name => onChange(renameFunction(state, i, name))}
            onRemove={() => onChange({ ...state, functions: removeAt(state.functions, i) })} />
        ))}
        <div style={styles.row}>
          <button onClick={() => addFunction('leap_year')}>+ Add leap-year function</button>
          <button onClick={() => addFunction('cycle_position')}>+ Add cycle-position function</button>
        </div>

        <h3>Cycles</h3>
        <p style={styles.note}>The largest cycle (by estimated duration) is counted first, then the next largest within what's left, and so on.</p>
        {state.cycles.map((cycle, i) => (
          <CycleCard key={i} cycle={cycle} onChange={c => updateCycle(i, c)} onRemove={() => removeCycle(i)}
            onMakeLeap={() => onChange(makeLeapStyle(state, i))} />
        ))}
        <button onClick={addCycle}>+ Add Cycle</button>

        <h3>Independent Cycles</h3>
        <p style={styles.note}>Cycles that tick continuously regardless of the cycles above (e.g. a weekday).</p>
        {state.independentCycles.map((ic, i) => (
          <IndependentCycleCard key={i} cycle={ic} onChange={c => updateIndependent(i, c)} onRemove={() => removeIndependent(i)} />
        ))}
        <button onClick={addIndependent}>+ Add Independent Cycle</button>

        <h3>Date Format</h3>
        <CalendarFormatBuilder state={state} onChange={onChange} preview={formatPreview} />
      </div>
    </BuilderContext.Provider>
  );
}

function FunctionCard({ fn, duplicate, onChange, onRename, onRemove }: {
  fn: BuilderFunction; duplicate: boolean;
  onChange: (f: BuilderFunction) => void; onRename: (name: string) => void; onRemove: () => void;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <label style={styles.label}>name</label>
        <input style={styles.input} value={fn.name} spellCheck={false} onChange={e => onRename(e.target.value)} />
        <span style={styles.note}>{fn.kind === 'leap_year' ? 'leap-year rules' : 'cycle position'}</span>
        <button onClick={onRemove}>Remove</button>
      </div>
      {duplicate && <div style={{ color: '#c0392b', fontSize: '0.85rem' }}>Another function has this name - only one will be kept.</div>}

      {fn.kind === 'leap_year' ? (
        <LeapRules rules={fn.rules} onChange={rules => onChange({ ...fn, rules })} />
      ) : (
        <>
          <div style={styles.row}>
            <label style={styles.label}>cycle length</label>
            <input style={styles.smallInput} type="number" value={fn.cycleLength}
              onChange={e => onChange({ ...fn, cycleLength: Number(e.target.value) })} />
          </div>
          <div style={styles.row}>
            <label style={styles.label}>true at positions (comma-separated, 0-based)</label>
            <NumberListInput value={fn.positions} onChange={positions => onChange({ ...fn, positions })} />
          </div>
          <div style={styles.note}>True when (argument mod cycle length) is one of the positions.</div>
        </>
      )}
    </div>
  );
}

function LeapRules({ rules, onChange }: { rules: LeapRule[]; onChange: (r: LeapRule[]) => void }) {
  function update(i: number, rule: LeapRule) {
    onChange(replaceAt(rules, i, rule));
  }
  return (
    <div style={styles.nested}>
      <strong>Rules</strong> (evaluated in order; first match wins; no match = false)
      {rules.map((rule, i) => (
        <div key={i} style={styles.row}>
          <span>if</span>
          <ValueEditor value={rule.value} onChange={value => update(i, { ...rule, value })} />
          <span>%</span>
          <input style={styles.smallInput} type="number" value={rule.divisor}
            onChange={e => update(i, { ...rule, divisor: Number(e.target.value) })} />
          <span>==</span>
          <input style={styles.smallInput} type="number" value={rule.equals}
            onChange={e => update(i, { ...rule, equals: Number(e.target.value) })} />
          <span>then</span>
          <select value={String(rule.result)} onChange={e => update(i, { ...rule, result: e.target.value === 'true' })}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <button title="Earlier" disabled={i === 0} onClick={() => onChange(moveAt(rules, i, i - 1))}>&uarr;</button>
          <button title="Later" disabled={i === rules.length - 1} onClick={() => onChange(moveAt(rules, i, i + 1))}>&darr;</button>
          <button onClick={() => onChange(removeAt(rules, i))}>Remove</button>
        </div>
      ))}
      <button onClick={() => onChange([...rules, { divisor: 4, equals: 0, value: { type: 'variable', name: 'year_index' }, result: true }])}>+ Add Rule</button>
    </div>
  );
}

function CycleCard({ cycle, onChange, onRemove, onMakeLeap }: {
  cycle: BuilderCycle; onChange: (c: BuilderCycle) => void; onRemove: () => void; onMakeLeap: () => void;
}) {
  const variable = `${cycle.id}_index`;

  function updateSub(i: number, sub: BuilderSubdivision) {
    onChange({ ...cycle, subdivisions: replaceAt(cycle.subdivisions, i, sub) });
  }
  function addSub(type: BuilderSubdivision['type']) {
    const sub: BuilderSubdivision = type === 'named_sequence'
      ? { type, units: [{ name: 'Unit 1', duration: { kind: 'fixed', ticks: 1 }, exceptions: [] }] }
      : { type, id: `${cycle.id}_part${cycle.subdivisions.length + 1}`, durationTicks: 1 };
    onChange({ ...cycle, subdivisions: [...cycle.subdivisions, sub] });
  }

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <label style={styles.label}>id</label>
        <input style={styles.input} value={cycle.id} onChange={e => onChange({ ...cycle, id: e.target.value })} />
        {cycle.duration.kind === 'fixed' && <button title="Different lengths in different iterations, e.g. leap years" onClick={onMakeLeap}>Make leap-style</button>}
        <button onClick={onRemove}>Remove</button>
      </div>

      <DurationEditor duration={cycle.duration} variable={variable}
        onChange={duration => onChange({ ...cycle, duration, estimatedTicks: duration.kind === 'fixed' ? null : cycle.estimatedTicks })} />

      {cycle.duration.kind !== 'fixed' && (
        <div style={styles.row}>
          <label style={styles.small}>
            <input type="checkbox" checked={cycle.estimatedTicks !== null}
              onChange={e => onChange({ ...cycle, estimatedTicks: e.target.checked ? autoEstimate(cycle.duration) : null })} /> override estimated duration
          </label>
          {cycle.estimatedTicks !== null
            ? <input style={styles.ticksInput} type="number" value={cycle.estimatedTicks}
              onChange={e => onChange({ ...cycle, estimatedTicks: Number(e.target.value) })} />
            : <span style={styles.note}>{autoEstimate(cycle.duration)} ticks (from the default / else length)</span>}
          <span style={styles.note}>decides which cycle is counted first</span>
        </div>
      )}

      <ExceptionsEditor exceptions={cycle.exceptions} indexLabel={cycle.id} onChange={exceptions => onChange({ ...cycle, exceptions })} />

      <div style={styles.nested}>
        <strong>Subdivisions</strong> <span style={styles.note}>(e.g. months within a year)</span>
        {cycle.subdivisions.map((sub, i) => (
          <SubdivisionCard key={i} sub={sub} parentId={cycle.id}
            onChange={s => updateSub(i, s)} onRemove={() => onChange({ ...cycle, subdivisions: removeAt(cycle.subdivisions, i) })} />
        ))}
        <div style={styles.row}>
          <button onClick={() => addSub('named_sequence')}>+ Named sequence (months...)</button>
          <button onClick={() => addSub('uniform')}>+ Uniform (equal parts)</button>
        </div>
      </div>
    </div>
  );
}

function SubdivisionCard({ sub, parentId, onChange, onRemove }: {
  sub: BuilderSubdivision; parentId: string; onChange: (s: BuilderSubdivision) => void; onRemove: () => void;
}) {
  if (sub.type === 'uniform') {
    return (
      <div style={styles.branch}>
        <div style={styles.row}>
          <strong>Uniform</strong>
          <label style={styles.label}>id</label>
          <input style={styles.input} value={sub.id} onChange={e => onChange({ ...sub, id: e.target.value })} />
          <label style={styles.label}>duration (ticks)</label>
          <input style={styles.ticksInput} type="number" value={sub.durationTicks}
            onChange={e => onChange({ ...sub, durationTicks: Number(e.target.value) })} />
          <button onClick={onRemove}>Remove</button>
        </div>
      </div>
    );
  }

  const seq = sub; // const keeps the named_sequence narrowing inside the closures below
  function updateUnit(i: number, unit: BuilderUnit) {
    onChange({ ...seq, units: replaceAt(seq.units, i, unit) });
  }
  return (
    <div style={styles.branch}>
      <div style={styles.row}>
        <strong>Named sequence</strong>
        <span style={styles.note}>units are walked in order; the last one absorbs any remainder</span>
        <button onClick={onRemove}>Remove</button>
      </div>
      {seq.units.map((unit, i) => (
        <div key={i} style={styles.branch}>
          <div style={styles.row}>
            <input style={styles.input} value={unit.name} placeholder="name" onChange={e => updateUnit(i, { ...unit, name: e.target.value })} />
            <button title="Earlier" disabled={i === 0} onClick={() => onChange({ ...seq, units: moveAt(seq.units, i, i - 1) })}>&uarr;</button>
            <button title="Later" disabled={i === seq.units.length - 1} onClick={() => onChange({ ...seq, units: moveAt(seq.units, i, i + 1) })}>&darr;</button>
            <button onClick={() => onChange({ ...seq, units: removeAt(seq.units, i) })}>Remove</button>
          </div>
          <DurationEditor duration={unit.duration} variable={`${parentId}_index`} onChange={duration => updateUnit(i, { ...unit, duration })} />
          <ExceptionsEditor exceptions={unit.exceptions} indexLabel={parentId} onChange={exceptions => updateUnit(i, { ...unit, exceptions })} />
        </div>
      ))}
      <button onClick={() => onChange({
        ...seq,
        units: [...seq.units, { name: `Unit ${seq.units.length + 1}`, duration: { kind: 'fixed', ticks: 1 }, exceptions: [] }],
      })}>+ Add Unit</button>
    </div>
  );
}

function IndependentCycleCard({ cycle, onChange, onRemove }: { cycle: BuilderIndependentCycle; onChange: (c: BuilderIndependentCycle) => void; onRemove: () => void }) {
  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <label style={styles.label}>id</label>
        <input style={styles.input} value={cycle.id} onChange={e => onChange({ ...cycle, id: e.target.value })} />
        <label style={styles.label}>duration (ticks)</label>
        <input style={styles.smallInput} type="number" value={cycle.durationTicks}
          onChange={e => onChange({ ...cycle, durationTicks: Number(e.target.value) })} />
        <label style={styles.label}>period</label>
        <input style={styles.smallInput} type="number" value={cycle.period}
          onChange={e => onChange({ ...cycle, period: Number(e.target.value) })} />
        <button onClick={onRemove}>Remove</button>
      </div>
      <div style={styles.row}>
        <label style={styles.label}>names (comma-separated, optional)</label>
        <input style={styles.input} value={cycle.names.join(',')}
          onChange={e => onChange({
            ...cycle,
            names: e.target.value.split(',').map(s => s.trim()).filter((v, i, { length }) => v || i === length - 1),
          })} />
      </div>
    </div>
  );
}
