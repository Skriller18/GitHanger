import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPost, API_BASE } from './api';

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

type ChatMessage = {
  id: string;
  ts: number;
  role: 'user' | 'agent';
  text: string;
};

type ApprovalRequest = {
  requestId: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
};

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toChatMessage(e: Event): ChatMessage | null {
  if (!['chat_user', 'chat_agent'].includes(e.kind)) return null;
  const payload = parseJson<{ role?: 'user' | 'agent'; text?: string }>(e.message);
  const text = payload?.text ?? e.message ?? '';
  if (!text.trim()) return null;
  const role = e.kind === 'chat_user' ? 'user' : payload?.role === 'agent' ? 'agent' : 'agent';
  return {
    id: `${e.ts}-${e.kind}-${text.slice(0, 10)}`,
    ts: e.ts,
    role,
    text,
  };
}

export function SessionDetailPage() {
  const { id } = useParams();
  const [session, setSession] = React.useState<Session | null>(null);
  const [events, setEvents] = React.useState<Event[]>([]);
  const [repoId, setRepoId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [chatInput, setChatInput] = React.useState('');
  const [sendingChat, setSendingChat] = React.useState(false);
  const [pendingApproval, setPendingApproval] = React.useState<ApprovalRequest | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const data = await apiGet<{ session?: Session; events?: Event[]; error?: string }>(`/api/sessions2/${id}`);
        if (data.error) throw new Error(data.error);
        setSession(data.session ?? null);
        setEvents(data.events ?? []);

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

  React.useEffect(() => {
    if (!id) return;
    const stream = new EventSource(`${API_BASE}/api/sessions2/${id}/stream`);

    const onEvent = (raw: MessageEvent<string>) => {
      try {
        const event = JSON.parse(raw.data) as Event;
        setEvents((prev) => [event, ...prev].slice(0, 500));

        if (event.kind === 'approval_required') {
          const payload = parseJson<ApprovalRequest>(event.message);
          if (payload?.requestId && payload?.title) {
            setPendingApproval(payload);
          }
        }
      } catch {
        // ignore malformed payload
      }
    };

    stream.addEventListener('event', onEvent as EventListener);
    stream.onerror = () => {
      // native EventSource will auto-reconnect
    };

    return () => {
      stream.removeEventListener('event', onEvent as EventListener);
      stream.close();
    };
  }, [id]);

  const chatMessages = React.useMemo(() => {
    const fromEvents = events.map(toChatMessage).filter(Boolean) as ChatMessage[];
    return [...fromEvents].sort((a, b) => a.ts - b.ts);
  }, [events]);

  const activityEvents = React.useMemo(() => {
    return [...events].sort((a, b) => b.ts - a.ts);
  }, [events]);

  if (err) return <div style={{ color: 'var(--danger)' }}>{err}</div>;
  if (!session) return <div>Loading…</div>;

  return (
    <div className="gh-session-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{session.name}</h3>
        <div className="gh-muted" style={{ fontWeight: 700 }}>{session.status}</div>
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

              <button
                onClick={async () => {
                  await apiPost(`/api/sessions2/${session.id}/approval-required`, {
                    title: 'Approve potentially risky command',
                    detail: 'Agent wants to run: git push --force-with-lease',
                  });
                }}
              >
                Simulate approval
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
          </div>
        </div>
      </div>

      <div className="gh-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="gh-card">
          <div className="gh-card-header">Chat</div>
          <div className="gh-card-body" style={{ display: 'grid', gap: 10 }}>
            <div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 8 }}>
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={`gh-chat-bubble ${m.role === 'user' ? 'is-user' : 'is-agent'}`}
                >
                  <div className="gh-chat-meta">
                    {m.role === 'user' ? 'You' : 'Agent'} · {new Date(m.ts).toLocaleTimeString()}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                </div>
              ))}
              {!chatMessages.length ? <div className="gh-muted">No chat messages yet.</div> : null}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const text = chatInput.trim();
                if (!text || sendingChat) return;
                setSendingChat(true);
                try {
                  await apiPost(`/api/sessions2/${session.id}/chat`, { message: text });
                  setChatInput('');
                } finally {
                  setSendingChat(false);
                }
              }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Send a message to this session"
                style={{ flex: 1 }}
              />
              <button type="submit" className="gh-btn-primary" disabled={sendingChat || !chatInput.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>

        <div className="gh-card">
          <div className="gh-card-header">Live activity stream</div>
          <div className="gh-card-body" style={{ maxHeight: 420, overflow: 'auto', display: 'grid', gap: 8 }}>
            {activityEvents.map((e, idx) => (
              <div key={`${e.ts}-${idx}`} className="gh-activity-row">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <b>{e.kind}</b>
                  <span className="gh-muted" style={{ fontSize: 12 }}>{new Date(e.ts).toLocaleString()}</span>
                </div>
                {e.message ? <pre className="gh-activity-message">{e.message}</pre> : null}
              </div>
            ))}
            {!activityEvents.length ? <div className="gh-muted">No events yet.</div> : null}
          </div>
        </div>
      </div>

      {pendingApproval ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div className="gh-card" style={{ width: 'min(560px, 92vw)' }}>
            <div className="gh-card-header">approval_required</div>
            <div className="gh-card-body" style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800 }}>{pendingApproval.title}</div>
                {pendingApproval.detail ? <div className="gh-muted" style={{ marginTop: 6 }}>{pendingApproval.detail}</div> : null}
                <div className="gh-code gh-muted" style={{ marginTop: 6 }}>requestId: {pendingApproval.requestId}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={async () => {
                    await apiPost(`/api/sessions2/${session.id}/approval`, {
                      requestId: pendingApproval.requestId,
                      decision: 'reject',
                    });
                    setPendingApproval(null);
                  }}
                >
                  Reject
                </button>
                <button
                  className="gh-btn-primary"
                  onClick={async () => {
                    await apiPost(`/api/sessions2/${session.id}/approval`, {
                      requestId: pendingApproval.requestId,
                      decision: 'approve',
                    });
                    setPendingApproval(null);
                  }}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
