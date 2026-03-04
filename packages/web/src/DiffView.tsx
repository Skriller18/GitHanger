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

export function DiffView(props: { files: DiffFile[]; title?: string }) {
  const [active, setActive] = React.useState<number>(0);
  const file = props.files[active];

  React.useEffect(() => {
    setActive(0);
  }, [props.files.length]);

  if (!props.files.length) {
    return <div className="gh-muted" style={{ padding: 12 }}>No diff</div>;
  }

  return (
    <div className="gh-card" style={{ height: 520 }}>
      {props.title ? <div className="gh-card-header">{props.title}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: props.title ? 480 : 520 }}>
        <div style={{ borderRight: '1px solid var(--border)', overflow: 'auto' }}>
          {props.files.map((f, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: i === active ? 'rgba(124, 58, 237, 0.18)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div className="gh-code" style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.to || f.from}
              </div>
            </button>
          ))}
        </div>

        <div style={{ overflow: 'auto' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 800 }}>
            <span className="gh-code">{file.to || file.from}</span>
          </div>
          <div style={{ padding: 12 }}>
            <div className="gh-code" style={{ fontSize: 12, lineHeight: 1.55 }}>
              {file.chunks.flatMap((c, idx) => renderChunk(c, idx))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderChunk(chunk: Chunk, idx: number) {
  const header = `@@ -${chunk.oldStart},${chunk.oldLines} +${chunk.newStart},${chunk.newLines} @@`;
  const lines: React.ReactNode[] = [];
  lines.push(
    <div key={`h-${idx}`} style={{ color: 'var(--muted)', padding: '6px 0' }}>
      {header}
    </div>
  );

  for (let i = 0; i < chunk.changes.length; i++) {
    const ch = chunk.changes[i];
    const bg =
      ch.type === 'add'
        ? 'rgba(34, 197, 94, 0.12)'
        : ch.type === 'del'
          ? 'rgba(239, 68, 68, 0.12)'
          : 'transparent';
    const fg =
      ch.type === 'add'
        ? 'rgba(187, 247, 208, 0.95)'
        : ch.type === 'del'
          ? 'rgba(254, 202, 202, 0.95)'
          : 'rgba(255,255,255,0.88)';
    const oldNo = ch.ln ?? '';
    const newNo = ch.ln2 ?? '';
    lines.push(
      <div
        key={`${idx}-${i}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '56px 56px 1fr',
          gap: 10,
          background: bg,
          color: fg,
          padding: '2px 6px',
          borderRadius: 8,
        }}
      >
        <span style={{ textAlign: 'right', opacity: 0.6 }}>{oldNo}</span>
        <span style={{ textAlign: 'right', opacity: 0.6 }}>{newNo}</span>
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ch.content}</span>
      </div>
    );
  }

  return lines;
}
