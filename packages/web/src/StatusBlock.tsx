export function StatusBlock(props: {
  title: string;
  items: Array<{ xy: string; file: string }>;
  actions: Array<{
    label: string;
    kind?: 'primary' | 'danger' | 'default';
    confirm?: (file: string) => string;
    run: (file: string) => Promise<void> | void;
  }>;
  disabled?: boolean;
}) {
  const { title, items, actions, disabled } = props;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <div style={{ fontWeight: 900 }}>{title}</div>
        {items.length ? <div className="gh-muted" style={{ fontSize: 12 }}>{items.length} files</div> : null}
      </div>

      {!items.length ? (
        <div className="gh-muted" style={{ fontSize: 12 }}>None</div>
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: 120, overflow: 'auto' }}>
          {items.map((it) => (
            <div key={`${it.xy}:${it.file}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div className="gh-code" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="gh-muted">{it.xy}</span> {it.file}
              </div>
              {actions.length ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  {actions.map((a) => (
                    <button
                      key={a.label}
                      disabled={disabled}
                      onClick={async () => {
                        if (a.confirm) {
                          const msg = a.confirm(it.file);
                          const ok = confirm(msg);
                          if (!ok) return;
                        }
                        await a.run(it.file);
                      }}
                      className={a.kind === 'primary' ? 'gh-btn-primary' : undefined}
                      style={
                        a.kind === 'danger'
                          ? { padding: '6px 10px', fontSize: 12, background: 'rgba(239, 68, 68, 0.14)', borderColor: 'rgba(239, 68, 68, 0.35)' }
                          : { padding: '6px 10px', fontSize: 12 }
                      }
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
