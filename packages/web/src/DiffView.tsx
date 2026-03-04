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
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [viewed, setViewed] = React.useState<Record<string, boolean>>({});

  const file = props.files[active];
  const fileKey = (f: DiffFile) => (f.to || f.from || '').toString();

  React.useEffect(() => {
    setActive(0);
  }, [props.files.length]);

  React.useEffect(() => {
    if (!file) return;
    setViewed((v) => ({ ...v, [fileKey(file)]: true }));
  }, [file?.to, file?.from]);

  if (!props.files.length) {
    return (
      <div className="gh-card">
        {props.title ? <div className="gh-card-header">{props.title}</div> : null}
        <div className="gh-card-body gh-muted">No diff</div>
      </div>
    );
  }

  const key = fileKey(file);
  const isCollapsed = !!collapsed[key];

  return (
    <div className="gh-card" style={{ height: 560 }}>
      {props.title ? (
        <div className="gh-card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>{props.title}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                const next: Record<string, boolean> = {};
                for (const f of props.files) next[fileKey(f)] = true;
                setCollapsed(next);
              }}
            >
              Collapse all
            </button>
            <button onClick={() => setCollapsed({})}>Expand all</button>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', height: props.title ? 520 : 560 }}>
        <div style={{ borderRight: '1px solid var(--border)', overflow: 'auto' }}>
          {props.files.map((f, i) => {
            const k = fileKey(f);
            const v = !!viewed[k];
            const c = !!collapsed[k];
            return (
              <div key={k} style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <button
                  onClick={() => setActive(i)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 'none',
                    background: i === active ? 'rgba(124, 58, 237, 0.18)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div className="gh-code" style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: v ? 0.9 : 1 }}>
                    {f.to || f.from}
                  </div>
                  <div className="gh-muted" style={{ fontSize: 11, marginTop: 4 }}>{v ? 'viewed' : 'new'}</div>
                </button>

                <button
                  title={c ? 'Expand file' : 'Collapse file'}
                  onClick={() => setCollapsed((m) => ({ ...m, [k]: !m[k] }))}
                  style={{ borderLeft: '1px solid rgba(255,255,255,0.06)', borderRadius: 0 }}
                >
                  {c ? '+' : '–'}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ overflow: 'auto' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 900, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="gh-code">{file.to || file.from}</span>
            <button onClick={() => setCollapsed((m) => ({ ...m, [key]: !m[key] }))}>{isCollapsed ? 'Expand' : 'Collapse'}</button>
          </div>
          <div style={{ padding: 12 }}>
            {isCollapsed ? (
              <div className="gh-muted">(collapsed)</div>
            ) : (
              <div className="gh-code" style={{ fontSize: 12, lineHeight: 1.55 }}>
                {file.chunks.flatMap((c, idx) => renderChunk(c, idx))}
              </div>
            )}
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
