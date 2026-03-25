import React from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import { useInterval } from './useInterval';

type Session = {
  id: string;
  name: string;
  provider: 'claude' | 'codex' | 'copilot';
  repoPath: string;
  worktreePath: string;
  branch: string;
  pid: number | null;
  status: 'running' | 'stopped' | 'crashed';
  startedAt: number;
  endedAt: number | null;
  lastEventTs?: number | null;
};

type Persona = {
  name: string;
  emoji: string;
  personality: string;
};

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function personaFor(session: Session): Persona {
  const first = ['Nova', 'Zara', 'Kiro', 'Milo', 'Echo', 'Vega', 'Nyx', 'Rin', 'Orin', 'Kael'];
  const second = ['Flux', 'Byte', 'Spark', 'Orbit', 'Pulse', 'Forge', 'Drift', 'Wisp', 'Core', 'Glint'];
  const emojis = ['🤖', '🧠', '🛠️', '⚡', '🛰️', '🧪', '🎯', '🔥', '🦾', '✨'];
  const vibes = [
    'Fast executor, keeps momentum high.',
    'Calm operator with clean handoffs.',
    'Sharp debugger with steady pacing.',
    'Explores options before locking direction.',
    'High-focus builder for active missions.',
  ];

  const seed = hashSeed(session.id);
  return {
    name: `${first[seed % first.length]} ${second[(seed >> 2) % second.length]}`,
    emoji: emojis[(seed >> 4) % emojis.length],
    personality: vibes[(seed >> 6) % vibes.length],
  };
}

function statusMood(status: Session['status']) {
  if (status === 'running') return 'thinking';
  if (status === 'crashed') return 'blocked';
  return 'idle';
}

export function SessionsPage() {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [deleting, setDeleting] = React.useState(false);

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

  React.useEffect(() => {
    const valid = new Set(sessions.map((s) => s.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => valid.has(id))));
  }, [sessions]);

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function deleteSelected() {
    if (!selectedIds.size || deleting) return;
    const ok = confirm(`Delete ${selectedIds.size} selected agent session(s)?`);
    if (!ok) return;

    setDeleting(true);
    try {
      await Promise.all(
        [...selectedIds].map((sid) =>
          apiPost(`/api/sessions2/${sid}/delete`, { removeWorktree: true }).catch(() => null),
        ),
      );
      setSelectedIds(new Set());
      await refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <h3 style={{ margin: '8px 0 12px' }}>Sessions</h3>
      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div className="gh-list-toolbar" style={{ marginBottom: 10 }}>
        <div className="gh-muted" style={{ fontSize: 12 }}>
          {selectedIds.size ? `${selectedIds.size} selected` : 'Select one or more agents to delete'}
        </div>
        <button
          onClick={deleteSelected}
          disabled={!selectedIds.size || deleting}
          style={{ background: 'rgba(239, 68, 68, 0.14)', borderColor: 'rgba(239, 68, 68, 0.35)' }}
        >
          {deleting ? 'Deleting…' : `Delete selected${selectedIds.size ? ` (${selectedIds.size})` : ''}`}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {sessions.map((s) => {
          const persona = personaFor(s);
          const mood = statusMood(s.status);
          const checked = selectedIds.has(s.id);

          return (
            <div key={s.id} className="gh-agent-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleSelection(s.id, e.target.checked)}
                    />
                  </label>
                  <div className={`gh-agent-avatar is-${mood}`}>
                    <span>{persona.emoji}</span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      {s.name} <span className="gh-muted" style={{ fontWeight: 500 }}>({s.provider})</span>
                    </div>
                    <div className="gh-muted" style={{ fontSize: 12 }}>
                      {persona.name}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className={`gh-status-badge is-${s.status}`}>
                    {s.status}
                  </div>
                  <Link to={`/session/${s.id}`} className="gh-pill">Open</Link>
                </div>
              </div>
              <div className="gh-muted" style={{ marginTop: 8 }}>{s.branch}</div>
              <div className="gh-muted" style={{ marginTop: 6, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                {s.worktreePath}
              </div>
            </div>
          );
        })}
        {!sessions.length ? <div style={{ color: '#666' }}>No sessions yet. Use <code>githanger run</code>.</div> : null}
      </div>
    </div>
  );
}
