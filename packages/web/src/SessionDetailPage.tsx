import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from './api';

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
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const data = await apiGet<{ session?: Session; events?: Event[]; error?: string }>(`/api/sessions2/${id}`);
        if (data.error) throw new Error(data.error);
        setSession(data.session ?? null);
        setEvents(data.events ?? []);
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

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div><b>Provider:</b> {session.provider}</div>
        <div><b>Branch:</b> {session.branch}</div>
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, color: '#666', marginTop: 6 }}>
          {session.worktreePath}
        </div>
        <div style={{ marginTop: 10 }}>
          <Link to={`/repo/unknown/wt?path=${encodeURIComponent(session.worktreePath)}`}>View worktree diff/commits</Link>
          <div style={{ fontSize: 12, color: '#666' }}>(repo id wiring coming next; this link still opens the worktree page)</div>
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
