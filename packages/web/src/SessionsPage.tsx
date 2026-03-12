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

function personaFor(session: Session) {
  const byProvider = {
    codex: { name: 'Codi', role: 'Fixer', emoji: '🛠️' },
    claude: { name: 'Clio', role: 'Strategist', emoji: '🧠' },
  } as const;

  return byProvider[session.provider] ?? { name: 'Nova', role: 'Scout', emoji: '✨' };
}

function statusMood(status: Session['status']) {
  if (status === 'running') return 'thinking';
  if (status === 'crashed') return 'blocked';
  return 'idle';
}

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
        {sessions.map((s) => {
          const persona = personaFor(s);
          const mood = statusMood(s.status);

          return (
            <Link
              key={s.id}
              to={`/session/${s.id}`}
              className="gh-agent-card"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div className={`gh-agent-avatar is-${mood}`}>
                    <span>{persona.emoji}</span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      {s.name} <span className="gh-muted" style={{ fontWeight: 500 }}>({s.provider})</span>
                    </div>
                    <div className="gh-muted" style={{ fontSize: 12 }}>
                      {persona.name} · {persona.role}
                    </div>
                  </div>
                </div>

                <div className={`gh-status-badge is-${s.status}`}>
                  {s.status}
                </div>
              </div>
              <div className="gh-muted" style={{ marginTop: 8 }}>{s.branch}</div>
              <div className="gh-muted" style={{ marginTop: 6, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                {s.worktreePath}
              </div>
            </Link>
          );
        })}
        {!sessions.length ? <div style={{ color: '#666' }}>No sessions yet. Use <code>githanger run</code>.</div> : null}
      </div>
    </div>
  );
}
