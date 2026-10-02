import type { BuilderState, FormatField, FormatSegment } from '../lib/calendarBuilder';
import { availableFormatFields } from '../lib/calendarBuilder';

type Props = {
  state: BuilderState;
  onChange: (state: BuilderState) => void;
  preview?: string | null; // the lab's currently-decoded timestamp, formatted with this format
};

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = arr.slice();
  copy.splice(to, 0, copy.splice(from, 1)[0]);
  return copy;
}

export default function CalendarFormatBuilder({ state, onChange, preview }: Props) {
  const fields = availableFormatFields(state);
  const segments = state.format;

  function setSegments(format: FormatSegment[]) {
    onChange({ ...state, format });
  }
  function updateSegment(i: number, seg: FormatSegment) {
    setSegments(segments.map((s, idx) => (idx === i ? seg : s)));
  }
  function addField() {
    setSegments([...segments, { kind: 'field', key: fields[0]?.key ?? '', offset: 0, pad: 0, ordinal: false }]);
  }
  function addText() {
    setSegments([...segments, { kind: 'text', text: ' ' }]);
  }

  return (
    <div>
      <p style={styles.note}>
        Build how dates are displayed by arranging text and calendar fields. Leave empty to show decoded dates as raw JSON.
      </p>

      <div style={styles.chips}>
        {segments.map((seg, i) => (
          <div key={i} style={seg.kind === 'field' ? styles.fieldChip : styles.textChip}>
            {seg.kind === 'text'
              ? <TextChip seg={seg} onChange={s => updateSegment(i, s)} />
              : <FieldChip seg={seg} fields={fields} onChange={s => updateSegment(i, s)} />}
            <div style={styles.chipControls}>
              <button title="Move left" disabled={i === 0} onClick={() => setSegments(moveItem(segments, i, i - 1))}>&larr;</button>
              <button title="Move right" disabled={i === segments.length - 1} onClick={() => setSegments(moveItem(segments, i, i + 1))}>&rarr;</button>
              <button title="Remove" onClick={() => setSegments(segments.filter((_, idx) => idx !== i))}>&times;</button>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.row}>
        <button onClick={addField} disabled={!fields.length}>+ Field</button>
        <button onClick={addText}>+ Text</button>
        {segments.length > 0 && <button onClick={() => setSegments([])}>Clear</button>}
      </div>

      {segments.length > 0 && preview != null && (
        <div style={styles.preview}>
          <span style={styles.note}>Preview: </span>
          <strong>{preview}</strong>
        </div>
      )}
    </div>
  );
}

function TextChip({ seg, onChange }: { seg: Extract<FormatSegment, { kind: 'text' }>; onChange: (s: FormatSegment) => void }) {
  return (
    <>
      <div style={styles.chipLabel}>text</div>
      {/* "%s" is the format template's placeholder token, so it can't appear in literal text */}
      <input style={styles.textInput} value={seg.text} spellCheck={false}
        onChange={e => onChange({ ...seg, text: e.target.value.split('%s').join('') })} />
    </>
  );
}

function FieldChip({ seg, fields, onChange }: { seg: Extract<FormatSegment, { kind: 'field' }>; fields: FormatField[]; onChange: (s: FormatSegment) => void }) {
  const known = fields.find(f => f.key === seg.key);
  const numeric = known ? known.numeric : true;

  return (
    <>
      <div style={styles.chipLabel}>field</div>
      <select value={seg.key} onChange={e => {
        const next = fields.find(f => f.key === e.target.value);
        // offsets and ordinal suffixes only make sense on numbers
        onChange(next && !next.numeric ? { ...seg, key: e.target.value, offset: 0, pad: 0, ordinal: false } : { ...seg, key: e.target.value });
      }}>
        {!known && <option value={seg.key}>{seg.key} (not in this calendar)</option>}
        {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      {numeric && (
        <div style={styles.chipOptions}>
          <label style={styles.small}>
            offset{' '}
            <input style={styles.offsetInput} type="number" value={seg.offset}
              onChange={e => onChange({ ...seg, offset: Number(e.target.value) })} />
          </label>
          <label style={styles.small}>
            zero-pad to{' '}
            <input style={styles.offsetInput} type="number" min={0} value={seg.pad}
              onChange={e => onChange({ ...seg, pad: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} />
          </label>
          <label style={styles.small}>
            <input type="checkbox" checked={seg.ordinal} onChange={e => onChange({ ...seg, ordinal: e.target.checked })} /> 1st, 2nd…
          </label>
        </div>
      )}
    </>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  note: { color: '#888', fontSize: '0.85rem' },
  small: { fontSize: '0.8rem', whiteSpace: 'nowrap' },
  row: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' },
  chips: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' },
  fieldChip: { border: '1px solid #2980b9', background: 'rgba(41, 128, 185, 0.08)', borderRadius: 6, padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  textChip: { border: '1px dashed #999', borderRadius: 6, padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  chipLabel: { fontSize: '0.7rem', textTransform: 'uppercase', color: '#888' },
  chipOptions: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  chipControls: { display: 'flex', gap: '0.2rem' },
  textInput: { width: 80, padding: '0.3rem', fontFamily: 'monospace', whiteSpace: 'pre' },
  offsetInput: { width: 50, padding: '0.2rem', fontFamily: 'monospace' },
  preview: { padding: '0.5rem', background: '#f5f5f5', color: '#111', borderRadius: 4 },
};
