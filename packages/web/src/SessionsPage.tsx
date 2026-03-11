import React from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from './api';
import { useInterval } from './useInterval';

type Session = {
  id: string;
  name: string;
  provider: 'claude' | 'codex';
  repoPath: string;
  worktreePath: string;
  branch: string;
  pid: number | null;
  status: 'running' | 'stopped' | 'crashed';
  startedAt: number;
  endedAt: number | null;
  lastEventTs?: number | null;
};

export function SessionsPage() {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const data = await apiGet<{ sessions: Session[] }>('/api/sessions2');
      setSessions(data.sessions);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  // Auto-poll so you don't need to reload the page.
  useInterval(() => {
    // Avoid spamming refresh when tab is in background.
    if (document.visibilityState !== 'visible') return;
    refresh();
  }, 3000);

  return (
    <div>
      <h3 style={{ margin: '8px 0 12px' }}>Sessions</h3>
      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div style={{ display: 'grid', gap: 8 }}>
        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/session/${s.id}`}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              textDecoration: 'none',
              color: 'var(--text)',
              background: 'var(--panel-soft)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontWeight: 700 }}>
                {s.name} <span className="gh-muted" style={{ fontWeight: 400 }}>({s.provider})</span>
              </div>
              <div style={{ color: s.status === 'running' ? 'var(--accent2)' : s.status === 'crashed' ? 'var(--danger)' : 'var(--muted)' }}>
                {s.status}
              </div>
            </div>
            <div className="gh-muted" style={{ marginTop: 6 }}>{s.branch}</div>
            <div className="gh-muted" style={{ marginTop: 6, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
              {s.worktreePath}
            </div>
          </Link>
        ))}
        {!sessions.length ? <div style={{ color: '#666' }}>No sessions yet. Use <code>githanger run</code>.</div> : null}
      </div>
    </div>
  );
}
