import type { BuilderCycle, BuilderIndependentCycle, BuilderState, BuilderUnit, LeapRule } from '../lib/calendarBuilder';

type Props = {
  state: BuilderState;
  onChange: (state: BuilderState) => void;
};

function replaceAt<T>(arr: T[], i: number, item: T): T[] {
  const copy = arr.slice();
  copy[i] = item;
  return copy;
}
function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, idx) => idx !== i);
}

export default function CalendarBuilderForm({ state, onChange }: Props) {
  function updateCycle(i: number, cycle: BuilderCycle) {
    onChange({ ...state, cycles: replaceAt(state.cycles, i, cycle) });
  }
  function addCycle() {
    onChange({
      ...state,
      cycles: [...state.cycles, { id: `cycle${state.cycles.length}`, kind: 'fixed', durationTicks: 1, leapBonusTicks: 0, leapRules: [], subdivisions: [] }],
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

  return (
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

      <h3>Cycles</h3>
      {state.cycles.map((cycle, i) => (
        <CycleCard key={i} cycle={cycle} onChange={c => updateCycle(i, c)} onRemove={() => removeCycle(i)} />
      ))}
      <button onClick={addCycle}>+ Add Cycle</button>

      <h3>Independent Cycles</h3>
      <p style={styles.note}>Cycles that tick continuously regardless of the cycles above (e.g. a weekday).</p>
      {state.independentCycles.map((ic, i) => (
        <IndependentCycleCard key={i} cycle={ic} onChange={c => updateIndependent(i, c)} onRemove={() => removeIndependent(i)} />
      ))}
      <button onClick={addIndependent}>+ Add Independent Cycle</button>
    </div>
  );
}

function CycleCard({ cycle, onChange, onRemove }: { cycle: BuilderCycle; onChange: (c: BuilderCycle) => void; onRemove: () => void }) {
  function updateRule(i: number, rule: LeapRule) {
    onChange({ ...cycle, leapRules: replaceAt(cycle.leapRules, i, rule) });
  }
  function addRule() {
    onChange({ ...cycle, leapRules: [...cycle.leapRules, { divisor: 4, equals: 0, result: true }] });
  }
  function removeRule(i: number) {
    onChange({ ...cycle, leapRules: removeAt(cycle.leapRules, i) });
  }

  function updateUnit(i: number, unit: BuilderUnit) {
    onChange({ ...cycle, subdivisions: replaceAt(cycle.subdivisions, i, unit) });
  }
  function addUnit() {
    onChange({ ...cycle, subdivisions: [...cycle.subdivisions, { name: `Unit ${cycle.subdivisions.length + 1}`, durationTicks: 1, leapBonusTicks: 0 }] });
  }
  function removeUnit(i: number) {
    onChange({ ...cycle, subdivisions: removeAt(cycle.subdivisions, i) });
  }

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <label style={styles.label}>id</label>
        <input style={styles.input} value={cycle.id} onChange={e => onChange({ ...cycle, id: e.target.value })} />
        <label style={styles.label}>type</label>
        <select value={cycle.kind} onChange={e => onChange({ ...cycle, kind: e.target.value as 'fixed' | 'leap' })}>
          <option value="fixed">Fixed duration</option>
          <option value="leap">Variable (leap-year style)</option>
        </select>
        <button onClick={onRemove}>Remove</button>
      </div>

      <div style={styles.row}>
        <label style={styles.label}>{cycle.kind === 'leap' ? 'base duration (ticks)' : 'duration (ticks)'}</label>
        <input style={styles.input} type="number" value={cycle.durationTicks}
          onChange={e => onChange({ ...cycle, durationTicks: Number(e.target.value) })} />
      </div>

      {cycle.kind === 'leap' && (
        <>
          <div style={styles.row}>
            <label style={styles.label}>leap bonus (ticks)</label>
            <input style={styles.input} type="number" value={cycle.leapBonusTicks}
              onChange={e => onChange({ ...cycle, leapBonusTicks: Number(e.target.value) })} />
          </div>

          <div style={styles.nested}>
            <strong>Leap rules</strong> (evaluated in order; first match wins; no match = not a leap iteration)
            {cycle.leapRules.map((rule, i) => (
              <div key={i} style={styles.row}>
                <span>if index %</span>
                <input style={styles.smallInput} type="number" value={rule.divisor}
                  onChange={e => updateRule(i, { ...rule, divisor: Number(e.target.value) })} />
                <span>==</span>
                <input style={styles.smallInput} type="number" value={rule.equals}
                  onChange={e => updateRule(i, { ...rule, equals: Number(e.target.value) })} />
                <span>then leap =</span>
                <select value={String(rule.result)} onChange={e => updateRule(i, { ...rule, result: e.target.value === 'true' })}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                <button onClick={() => removeRule(i)}>Remove</button>
              </div>
            ))}
            <button onClick={addRule}>+ Add Rule</button>
          </div>

          <div style={styles.nested}>
            <strong>Subdivisions</strong> (e.g. months/seasons within this cycle)
            {cycle.subdivisions.map((unit, i) => (
              <div key={i} style={styles.row}>
                <input style={styles.input} value={unit.name} placeholder="name"
                  onChange={e => updateUnit(i, { ...unit, name: e.target.value })} />
                <label style={styles.label}>duration</label>
                <input style={styles.smallInput} type="number" value={unit.durationTicks}
                  onChange={e => updateUnit(i, { ...unit, durationTicks: Number(e.target.value) })} />
                <label style={styles.label}>leap bonus</label>
                <input style={styles.smallInput} type="number" value={unit.leapBonusTicks}
                  onChange={e => updateUnit(i, { ...unit, leapBonusTicks: Number(e.target.value) })} />
                <button onClick={() => removeUnit(i)}>Remove</button>
              </div>
            ))}
            <button onClick={addUnit}>+ Add Subdivision</button>
          </div>
        </>
      )}
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
        <input style={styles.input} value={cycle.names.join(', ')}
          onChange={e => onChange({ ...cycle, names: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  row: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' },
  label: { fontSize: '0.85rem', color: '#666', whiteSpace: 'nowrap' },
  input: { flex: 1, minWidth: 80, padding: '0.3rem', fontFamily: 'monospace' },
  smallInput: { width: 70, padding: '0.3rem', fontFamily: 'monospace' },
  card: { border: '1px solid #ccc', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' },
  nested: { marginTop: '0.5rem', paddingLeft: '0.75rem', borderLeft: '2px solid #ddd' },
  note: { color: '#888', fontSize: '0.85rem' },
};
