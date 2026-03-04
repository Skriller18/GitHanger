export function StatusBlock(props: {
  title: string;
  items: Array<{ xy: string; file: string }>;
  actionLabel: string | null;
  disabled?: boolean;
  onAction: (file: string) => Promise<void> | void;
}) {
  const { title, items, actionLabel, onAction, disabled } = props;

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
              {actionLabel ? (
                <button
                  disabled={disabled}
                  onClick={() => onAction(it.file)}
                  style={{ padding: '6px 10px', fontSize: 12 }}
                >
                  {actionLabel}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
