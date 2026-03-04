import React from 'react';

type Change = {
  type: 'add' | 'del' | 'normal';
  ln?: number;
  ln2?: number;
  content: string;
};

type Chunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: Change[];
};

type DiffFile = {
  from: string;
  to: string;
  chunks: Chunk[];
};

export function DiffView(props: { files: DiffFile[] }) {
  const [active, setActive] = React.useState<number>(0);
  const file = props.files[active];

  if (!props.files.length) return <div style={{ padding: 12 }}>No diff</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, height: 'calc(100vh - 120px)' }}>
      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'auto' }}>
        {props.files.map((f, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid #eee',
              background: i === active ? '#f5f5f5' : 'white',
              cursor: 'pointer',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
            }}
          >
            {f.to || f.from}
          </button>
        ))}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'auto' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #eee', fontWeight: 600 }}>
          {file.to || file.from}
        </div>
        <pre style={{ margin: 0, padding: 12, fontSize: 12, lineHeight: 1.45 }}>
          {file.chunks.flatMap((c, idx) => renderChunk(c, idx))}
        </pre>
      </div>
    </div>
  );
}

function renderChunk(chunk: Chunk, idx: number) {
  const header = `@@ -${chunk.oldStart},${chunk.oldLines} +${chunk.newStart},${chunk.newLines} @@`;
  const lines: React.ReactNode[] = [];
  lines.push(
    <div key={`h-${idx}`} style={{ color: '#6a737d' }}>
      {header}
    </div>
  );

  for (let i = 0; i < chunk.changes.length; i++) {
    const ch = chunk.changes[i];
    const bg = ch.type === 'add' ? '#e6ffed' : ch.type === 'del' ? '#ffeef0' : 'transparent';
    const fg = ch.type === 'add' ? '#22863a' : ch.type === 'del' ? '#b31d28' : '#24292e';
    const oldNo = ch.ln ?? '';
    const newNo = ch.ln2 ?? '';
    lines.push(
      <div
        key={`${idx}-${i}`}
        style={{ display: 'grid', gridTemplateColumns: '52px 52px 1fr', gap: 8, background: bg, color: fg }}
      >
        <span style={{ textAlign: 'right', opacity: 0.7 }}>{oldNo}</span>
        <span style={{ textAlign: 'right', opacity: 0.7 }}>{newNo}</span>
        <span>{ch.content}</span>
      </div>
    );
  }

  return lines;
}
