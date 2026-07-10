import { useMemo, useState } from 'react';
import { CalendarSystem, gregorianCalendar, decimalCalendar, thessianCalendar } from '../lib/calendars';
import type { BuilderState } from '../lib/calendarBuilder';
import { blankBuilderState, buildDefinition, tryParseIntoBuilderState } from '../lib/calendarBuilder';
import CalendarBuilderForm from '../components/CalendarBuilderForm';

const PRESETS: { [name: string]: any } = {
  'Gregorian': gregorianCalendar,
  'Decimal': decimalCalendar,
  'Thessian (showcase)': thessianCalendar,
  'Blank': { name: 'New Calendar', epoch: { timestamp: 0 }, cycles: [{ id: 'day', duration_ticks: 1 }] },
};

// 1 tick = 100ms, matching the convention baked into the preset calendars' epochs
// (see the Math.floor(Date.now() / 100) usage in src/lib/calendars.js).
const TICKS_PER_MS = 1 / 100;

export default function CalendarLab() {
  const [defText, setDefText] = useState(() => JSON.stringify(gregorianCalendar, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [builderState, setBuilderState] = useState<BuilderState | null>(() => tryParseIntoBuilderState(gregorianCalendar));

  const [ticksInput, setTicksInput] = useState(() => String(Math.floor(Date.now() * TICKS_PER_MS)));
  const [format, setFormat] = useState<'full' | 'gregorian'>('gregorian');

  const [fieldsInput, setFieldsInput] = useState('{\n  "year": 2024,\n  "year_subdivision_index": 1,\n  "day": 28\n}');

  const calendarDef = useMemo(() => {
    try {
      const parsed = JSON.parse(defText);
      setParseError(null);
      return parsed;
    } catch (err) {
      setParseError((err as Error).message);
      return null;
    }
  }, [defText]);

  const calendar = useMemo(() => {
    if (!calendarDef) return null;
    try {
      return new CalendarSystem(calendarDef);
    } catch {
      return null;
    }
  }, [calendarDef]);

  function loadPreset(name: string) {
    const preset = PRESETS[name];
    setDefText(JSON.stringify(preset, null, 2));
    setBuilderState(tryParseIntoBuilderState(preset));
  }

  function switchToVisual() {
    setBuilderState(tryParseIntoBuilderState(calendarDef));
    setMode('visual');
  }

  function handleBuilderChange(newState: BuilderState) {
    setBuilderState(newState);
    setDefText(JSON.stringify(buildDefinition(newState), null, 2));
  }

  function startBlankVisual() {
    const blank = blankBuilderState();
    setBuilderState(blank);
    setDefText(JSON.stringify(buildDefinition(blank), null, 2));
  }

  // Timestamp -> Calendar
  let decodeResult: { data: any; formatted: string; roundTripDiff: number; resolution: number } | null = null;
  let decodeError: string | null = null;
  if (calendar) {
    try {
      const ticks = Number(ticksInput);
      if (Number.isNaN(ticks)) throw new Error('Timestamp must be a number');
      const data = calendar.timestampToCalendar(ticks);
      const formatted = calendar.formatCalendar(data, format);
      const roundTripDiff = calendar.calendarToTimestamp(data) - ticks;
      const resolution = calendar.getResolution();
      decodeResult = { data, formatted, roundTripDiff, resolution };
    } catch (err) {
      decodeError = (err as Error).message;
    }
  }

  // Calendar -> Timestamp
  let encodeResult: { timestamp: number; redecoded: any } | null = null;
  let encodeError: string | null = null;
  if (calendar) {
    try {
      const fields = JSON.parse(fieldsInput);
      const timestamp = calendar.calendarToTimestamp(fields);
      const redecoded = calendar.timestampToCalendar(timestamp);
      encodeResult = { timestamp, redecoded };
    } catch (err) {
      encodeError = (err as Error).message;
    }
  }

  return (
    <div style={styles.page}>
      <h1>Calendar Lab</h1>
      <p style={styles.note}>
        Standalone testing sandbox for the custom calendar engine (<code>editor/src/lib/calendars.ts</code>, ported from{' '}
        <code>src/lib/calendars.js</code>). Not linked from the main site - just for poking at calendar definitions.
      </p>

      <div style={styles.columns}>
        <div style={styles.column}>
          <h2>Calendar Definition</h2>
          <div style={styles.presetRow}>
            {Object.keys(PRESETS).map(name => (
              <button key={name} onClick={() => loadPreset(name)}>{name}</button>
            ))}
          </div>
          <div style={styles.tabRow}>
            <button style={mode === 'visual' ? styles.tabActive : styles.tab} onClick={switchToVisual}>Visual Builder</button>
            <button style={mode === 'json' ? styles.tabActive : styles.tab} onClick={() => setMode('json')}>Raw JSON</button>
          </div>

          {mode === 'visual' ? (
            builderState ? (
              <div style={styles.builderBox}>
                <CalendarBuilderForm state={builderState} onChange={handleBuilderChange} />
              </div>
            ) : (
              <div style={styles.builderBox}>
                <p style={styles.error}>
                  This calendar definition uses features the Visual Builder doesn't support yet
                  (e.g. era/reform comparisons, exceptions, or custom and/or/not logic) - edit it as Raw JSON instead,
                  or start a new calendar here:
                </p>
                <button onClick={startBlankVisual}>Start blank calendar in Visual Builder</button>
              </div>
            )
          ) : (
            <>
              <textarea
                style={styles.jsonArea}
                value={defText}
                onChange={e => setDefText(e.target.value)}
                spellCheck={false}
              />
              {parseError && <div style={styles.error}>Invalid JSON: {parseError}</div>}
            </>
          )}
        </div>

        <div style={styles.column}>
          <h2>Timestamp &rarr; Calendar</h2>
          <div style={styles.row}>
            <input
              style={styles.input}
              value={ticksInput}
              onChange={e => setTicksInput(e.target.value)}
              placeholder="timestamp (ticks)"
            />
            <button onClick={() => setTicksInput(String(Math.floor(Date.now() * TICKS_PER_MS)))}>Now</button>
            <select value={format} onChange={e => setFormat(e.target.value as any)}>
              <option value="gregorian">gregorian-style format</option>
              <option value="full">raw JSON</option>
            </select>
          </div>
          {decodeError && <div style={styles.error}>{decodeError}</div>}
          {decodeResult && (
            <>
              <pre style={styles.output}>{decodeResult.formatted}</pre>
              <details>
                <summary>Full decoded fields</summary>
                <pre style={styles.output}>{JSON.stringify(decodeResult.data, null, 2)}</pre>
              </details>
              {(() => {
                const withinResolution = Math.abs(decodeResult.roundTripDiff) < decodeResult.resolution;
                return (
                  <div style={withinResolution ? styles.ok : styles.error}>
                    Round-trip diff: {decodeResult.roundTripDiff} ticks (calendar resolution: {decodeResult.resolution} ticks) {withinResolution
                      ? decodeResult.roundTripDiff === 0 ? '(consistent)' : '(expected - input is finer than this calendar tracks)'
                      : '(MISMATCH - unexpected, larger than the calendar\'s own resolution)'}
                  </div>
                );
              })()}
            </>
          )}

          <h2>Calendar &rarr; Timestamp</h2>
          <p style={styles.note}>Enter any subset of calendar fields (e.g. <code>year</code>, <code>year_subdivision_index</code>, <code>day</code>, <code>hour</code>...).</p>
          <textarea
            style={styles.smallJsonArea}
            value={fieldsInput}
            onChange={e => setFieldsInput(e.target.value)}
            spellCheck={false}
          />
          {encodeError && <div style={styles.error}>{encodeError}</div>}
          {encodeResult && (
            <>
              <div style={styles.output}>timestamp = {encodeResult.timestamp}</div>
              <details>
                <summary>Re-decoded (sanity check)</summary>
                <pre style={styles.output}>{JSON.stringify(encodeResult.redecoded, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: 1200, margin: '0 auto', padding: '1rem 2rem', fontFamily: 'sans-serif' },
  note: { color: '#888', fontSize: '0.9rem' },
  columns: { display: 'flex', gap: '2rem', flexWrap: 'wrap' },
  column: { flex: '1 1 480px', minWidth: 0 },
  presetRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' },
  tabRow: { display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' },
  tab: { padding: '0.4rem 0.8rem', background: 'none', borderBottom: '2px solid transparent' },
  tabActive: { padding: '0.4rem 0.8rem', borderBottom: '2px solid #2980b9', fontWeight: 'bold' },
  builderBox: { maxHeight: 560, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4, padding: '0.75rem' },
  row: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' },
  input: { flex: 1, padding: '0.4rem', fontFamily: 'monospace' },
  jsonArea: { width: '100%', height: 500, fontFamily: 'monospace', fontSize: '0.85rem', boxSizing: 'border-box' },
  smallJsonArea: { width: '100%', height: 100, fontFamily: 'monospace', fontSize: '0.85rem', boxSizing: 'border-box' },
  output: { background: '#f5f5f5', color: '#111', padding: '0.5rem', overflowX: 'auto', borderRadius: 4 },
  error: { color: '#c0392b', fontWeight: 'bold', margin: '0.5rem 0' },
  ok: { color: '#27ae60', fontWeight: 'bold', margin: '0.5rem 0' },
};
