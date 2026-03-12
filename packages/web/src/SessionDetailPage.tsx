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

type EventVisual = {
  icon: string;
  label: string;
  tone: 'chat' | 'system' | 'approval' | 'runtime' | 'error';
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

function statusMood(status: Session['status']) {
  if (status === 'running') return 'thinking';
  if (status === 'crashed') return 'blocked';
  return 'idle';
}

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function personaFor(session: Session) {
  const first = ['Nova', 'Zara', 'Kiro', 'Milo', 'Echo', 'Vega', 'Nyx', 'Rin', 'Orin', 'Kael'];
  const second = ['Flux', 'Byte', 'Spark', 'Orbit', 'Pulse', 'Forge', 'Drift', 'Wisp', 'Core', 'Glint'];
  const emojis = ['🤖', '🧠', '🛠️', '⚡', '🛰️', '🧪', '🎯', '🔥', '🦾', '✨'];
  const vibes = [
    'Fast executor with frequent checkpoints.',
    'Calm operator with clean context handoffs.',
    'Focused debugger for tricky flows.',
    'Explores before committing to a direction.',
    'High-energy builder for live missions.',
  ];

  const seed = hashSeed(session.id);
  return {
    name: `${first[seed % first.length]} ${second[(seed >> 2) % second.length]}`,
    emoji: emojis[(seed >> 4) % emojis.length],
    personality: vibes[(seed >> 6) % vibes.length],
  };
}

function visualForEvent(kind: string): EventVisual {
  if (kind === 'chat_user') return { icon: '💬', label: 'User chat', tone: 'chat' };
  if (kind === 'chat_agent') return { icon: '🤖', label: 'Agent reply', tone: 'chat' };
  if (kind === 'approval_required') return { icon: '🛂', label: 'Approval required', tone: 'approval' };
  if (kind.includes('error') || kind === 'crashed') return { icon: '⛔', label: 'Error', tone: 'error' };
  if (kind.includes('start') || kind.includes('stop') || kind.includes('terminate')) {
    return { icon: '⚙️', label: 'Runtime', tone: 'runtime' };
  }
  return { icon: '📡', label: 'System', tone: 'system' };
}

function summarizeActivity(e: Event): string {
  if (e.kind === 'chat_user') return 'Operator sent a mission prompt.';
  if (e.kind === 'chat_agent') return 'Agent posted a live response.';
  if (e.kind === 'approval_required') return 'Risky action paused, waiting for approval.';
  if (e.kind.includes('error') || e.kind === 'crashed') return 'An execution error was reported.';
  return e.kind.replaceAll('_', ' ');
}

function friendlyIntent(session: Session): string {
  if (session.status === 'running') return `Running on ${session.branch} and streaming mission telemetry.`;
  if (session.status === 'crashed') return 'Execution interrupted. Needs human intervention to continue.';
  return 'Standing by for the next operator instruction.';
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

  const persona = personaFor(session);
  const mood = statusMood(session.status);

  return (
    <div className="gh-session-detail">
      <div className="gh-stage-hero" style={{ marginBottom: 12 }}>
        <div className="gh-stage-hero-main">
          <div className={`gh-agent-avatar gh-stage-hero-avatar is-${mood}`}>
            <span>{persona.emoji}</span>
          </div>
          <div>
            <div className="gh-stage-hero-title">{session.name}</div>
            <div className="gh-stage-hero-subtitle">
              {persona.name} · role: {session.name} · {session.provider}
            </div>
            <div className="gh-stage-intent">{friendlyIntent(session)}</div>
          </div>
        </div>
        <div className={`gh-status-badge is-${session.status}`}>{session.status}</div>
      </div>

      <div className="gh-card" style={{ marginBottom: 16 }}>
        <div className="gh-card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div><b>Provider:</b> {session.provider}</div>
              <div><b>Branch:</b> {session.branch}</div>
              <div className="gh-code gh-muted" style={{ marginTop: 8 }}>{session.worktreePath}</div>
              <div className="gh-muted" style={{ marginTop: 8, fontSize: 12 }}>{persona.personality}</div>
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

      <div className="gh-grid gh-session-detail-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                    <span className={`gh-event-chip is-${m.role === 'user' ? 'chat' : 'runtime'}`}>
                      {m.role === 'user' ? '💬 User' : '🤖 Agent'}
                    </span>
                    <span>{new Date(m.ts).toLocaleTimeString()}</span>
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
          <div className="gh-card-header">Mission timeline</div>
          <div className="gh-card-body gh-timeline-wrap" style={{ maxHeight: 420, overflow: 'auto', display: 'grid', gap: 8 }}>
            {activityEvents.map((e, idx) => {
              const visual = visualForEvent(e.kind);
              return (
                <div key={`${e.ts}-${idx}`} className={`gh-activity-row gh-timeline-row is-${visual.tone}`} style={{ animationDelay: `${Math.min(idx, 18) * 24}ms` }}>
                  <div className="gh-timeline-dot" aria-hidden="true" />
                  <div className="gh-timeline-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={`gh-event-chip is-${visual.tone}`}>
                          {visual.icon} {visual.label}
                        </span>
                        <b>{summarizeActivity(e)}</b>
                      </div>
                      <span className="gh-muted" style={{ fontSize: 12 }}>{new Date(e.ts).toLocaleString()}</span>
                    </div>
                    <div className="gh-muted" style={{ fontSize: 12, marginTop: 4 }}>{e.kind}</div>
                    {e.message ? <pre className="gh-activity-message">{e.message}</pre> : null}
                  </div>
                </div>
              );
            })}
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
