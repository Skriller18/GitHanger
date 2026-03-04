import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPost } from './api';

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
};

type Event = { ts: number; kind: string; message?: string | null };

export function SessionDetailPage() {
  const { id } = useParams();
  const [session, setSession] = React.useState<Session | null>(null);
  const [events, setEvents] = React.useState<Event[]>([]);
  const [repoId, setRepoId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const data = await apiGet<{ session?: Session; events?: Event[]; error?: string }>(`/api/sessions2/${id}`);
        if (data.error) throw new Error(data.error);
        setSession(data.session ?? null);
        setEvents(data.events ?? []);

        // resolve repoId by repoPath so we can link to worktree page safely.
        if (data.session?.repoPath) {
          const r = await apiGet<{ repos: Array<{ id: string; path: string }> }>('/api/repos');
          const match = r.repos.find((x) => x.path === data.session!.repoPath);
          setRepoId(match?.id ?? null);
        }
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [id]);

  if (err) return <div style={{ color: 'crimson' }}>{err}</div>;
  if (!session) return <div>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{session.name}</h3>
        <div style={{ color: '#666' }}>{session.status}</div>
      </div>

      <div className="gh-card" style={{ marginBottom: 16 }}>
        <div className="gh-card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div><b>Provider:</b> {session.provider}</div>
              <div><b>Branch:</b> {session.branch}</div>
              <div className="gh-code gh-muted" style={{ marginTop: 8 }}>{session.worktreePath}</div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <button
                className="gh-btn-primary"
                disabled={session.status !== 'running' || !session.pid}
                onClick={async () => {
                  const ok = confirm(`Terminate session?\n\n${session.name} (pid=${session.pid ?? '—'})`);
                  if (!ok) return;
                  const res: any = await apiPost(`/api/sessions2/${session.id}/terminate`, {});
                  if (!res.ok) alert(res.message ?? res.error ?? 'terminate failed');
                  window.location.reload();
                }}
              >
                Terminate
              </button>

              <button
                onClick={async () => {
                  const ok = confirm(`Delete session record (and remove worktree if managed)?\n\n${session.name}`);
                  if (!ok) return;
                  const res: any = await apiPost(`/api/sessions2/${session.id}/delete`, { removeWorktree: true });
                  if (res.worktreeRemoveError) alert(`Worktree remove error: ${res.worktreeRemoveError}`);
                  window.location.href = '/sessions';
                }}
                style={{ background: 'rgba(239, 68, 68, 0.14)', borderColor: 'rgba(239, 68, 68, 0.35)' }}
              >
                Delete
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {repoId ? (
              <Link to={`/repo/${repoId}/wt?path=${encodeURIComponent(session.worktreePath)}`} className="gh-pill">
                View worktree diff/commits
              </Link>
            ) : (
              <Link to={`/wt?path=${encodeURIComponent(session.worktreePath)}`} className="gh-pill">
                View worktree diff/commits
              </Link>
            )}
            {!repoId ? (
              <div className="gh-muted" style={{ fontSize: 12, marginTop: 6 }}>
                (Repo not registered yet; actions may be limited)
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', background: '#fafafa', borderBottom: '1px solid #eee', fontWeight: 700 }}>
          Recent events
        </div>
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          {events.map((e, idx) => (
            <div key={idx} style={{ padding: '10px 12px', borderBottom: '1px solid #f1f1f1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{e.kind}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{new Date(e.ts).toLocaleString()}</div>
              </div>
              {e.message ? (
                <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 12 }}>{e.message}</pre>
              ) : null}
            </div>
          ))}
          {!events.length ? <div style={{ padding: 12, color: '#666' }}>No events yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
