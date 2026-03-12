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

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

function isHeartbeatOrNoiseEvent(e: Event): boolean {
  const k = lower(e.kind);
  const m = lower(e.message);

  return (
    k.includes('heartbeat') ||
    m === 'heartbeat_ok' ||
    m.includes('heartbeat_ok') ||
    k.includes('stream_ready') ||
    k.includes('connected') ||
    k.includes('ping') ||
    m.includes('node-pty unavailable') ||
    m.includes('fallback:inherit') ||
    m.includes('post_spawn failed')
  );
}

function summarizeEvent(e: Event): string {
  if (e.kind === 'approval_required') return 'Approval required';

  if (e.kind === 'approval_decision') {
    const payload = parseJson<{ decision?: string }>(e.message);
    const decision = payload?.decision ? payload.decision.toLowerCase() : 'updated';
    return `Approval ${decision}`;
  }

  const payload = parseJson<{ text?: string; detail?: string; title?: string; message?: string }>(e.message);
  const text = payload?.text ?? payload?.detail ?? payload?.title ?? payload?.message ?? e.message ?? '';
  const compact = text.replace(/\s+/g, ' ').trim();

  if (compact) return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
  return e.kind.replaceAll('_', ' ');
}

function extractEditedPaths(e: Event): string[] {
  const found = new Set<string>();

  const add = (input: string) => {
    const value = input.trim().replace(/^['"]|['"]$/g, '');
    if (!value) return;
    if (value.length > 220) return;

    const pathLike = /(?:\/[\w.-]+)+|(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html|py|go|rs|java|kt|swift|rb|php|c|cc|cpp|h)/i;
    if (pathLike.test(value)) found.add(value);
  };

  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === 'string') {
      const lineRegex = /([./~]?[\w./-]+\.[a-zA-Z0-9]+|\/[\w./-]+)/g;
      for (const match of node.matchAll(lineRegex)) {
        if (match[1]) add(match[1]);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const key = k.toLowerCase();
        if (typeof v === 'string' && (key.includes('path') || key.includes('file') || key.includes('target'))) {
          add(v);
        }
        walk(v);
      }
    }
  };

  walk(parseJson<unknown>(e.message));
  walk(e.message ?? '');

  return [...found].slice(0, 3);
}

function findLatestPendingApproval(events: Event[]): ApprovalRequest | null {
  const sorted = [...events].sort((a, b) => b.ts - a.ts);

  for (const e of sorted) {
    if (e.kind === 'approval_decision') return null;

    if (e.kind === 'approval_required') {
      const payload = parseJson<ApprovalRequest>(e.message);
      if (payload?.requestId && payload?.title) return payload;
      return {
        requestId: `unknown-${e.ts}`,
        title: 'Approval required',
        detail: e.message ?? undefined,
      };
    }
  }

  return null;
}

export function SessionDetailPage() {
  const { id } = useParams();
  const [session, setSession] = React.useState<Session | null>(null);
  const [events, setEvents] = React.useState<Event[]>([]);
  const [repoId, setRepoId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = React.useState<ApprovalRequest | null>(null);
  const [includeNoise, setIncludeNoise] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const data = await apiGet<{ session?: Session; events?: Event[]; error?: string }>(`/api/sessions2/${id}`);
        if (data.error) throw new Error(data.error);

        const fetchedEvents = data.events ?? [];
        setSession(data.session ?? null);
        setEvents(fetchedEvents);
        setPendingApproval(findLatestPendingApproval(fetchedEvents));

        if (data.session?.repoPath) {
          const r = await apiGet<{ repos: Array<{ id: string; path: string }> }>('/api/repos');
          const match = r.repos.find((x) => x.path === data.session?.repoPath);
          setRepoId(match?.id ?? null);
        }
      } catch (error: unknown) {
        if (error instanceof Error) setErr(error.message);
        else setErr(String(error));
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
          } else {
            setPendingApproval({
              requestId: `unknown-${event.ts}`,
              title: 'Approval required',
              detail: event.message ?? undefined,
            });
          }
        }

        if (event.kind === 'approval_decision') {
          setPendingApproval(null);
        }
      } catch {
        // ignore malformed payload
      }
    };

    stream.addEventListener('event', onEvent as EventListener);
    stream.onerror = () => {
      // native EventSource auto-reconnects
    };

    return () => {
      stream.removeEventListener('event', onEvent as EventListener);
      stream.close();
    };
  }, [id]);

  const sortedEvents = React.useMemo(() => [...events].sort((a, b) => b.ts - a.ts), [events]);

  const timelineEvents = React.useMemo(() => {
    if (includeNoise) return sortedEvents;
    return sortedEvents.filter((e) => !isHeartbeatOrNoiseEvent(e));
  }, [sortedEvents, includeNoise]);

  if (err) return <div style={{ color: 'var(--danger)' }}>{err}</div>;
  if (!session) return <div>Loading…</div>;

  const diffLink = repoId
    ? `/repo/${repoId}/wt?path=${encodeURIComponent(session.worktreePath)}`
    : `/wt?path=${encodeURIComponent(session.worktreePath)}`;

  return (
    <div className="gh-session-detail gh-grid" style={{ gap: 12 }}>
      <div className="gh-card">
        <div className="gh-card-header">Session</div>
        <div className="gh-card-body gh-session-basic-grid">
          <div>
            <div className="gh-muted">Name</div>
            <div>{session.name}</div>
          </div>
          <div>
            <div className="gh-muted">Provider</div>
            <div>{session.provider}</div>
          </div>
          <div>
            <div className="gh-muted">Branch</div>
            <div className="gh-code">{session.branch}</div>
          </div>
          <div>
            <div className="gh-muted">Status</div>
            <div className={`gh-status-badge is-${session.status}`}>{session.status}</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Link to={diffLink} className="gh-pill">
              Open worktree diff
            </Link>
            <span className="gh-code gh-muted" style={{ marginLeft: 10 }}>{session.worktreePath}</span>
          </div>
        </div>
      </div>

      <div className={`gh-card ${pendingApproval ? 'gh-approval-card is-pending' : 'gh-approval-card'}`}>
        <div className="gh-card-header">Approval</div>
        <div className="gh-card-body gh-grid" style={{ gap: 10 }}>
          {pendingApproval ? (
            <>
              <div className="gh-approval-title">Approval required</div>
              <div style={{ fontWeight: 700 }}>{pendingApproval.title}</div>
              {pendingApproval.detail ? <div className="gh-muted">{pendingApproval.detail}</div> : null}
              <div className="gh-code gh-muted">requestId: {pendingApproval.requestId}</div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
            </>
          ) : (
            <div className="gh-muted">No approval pending.</div>
          )}
        </div>
      </div>

      <div className="gh-card">
        <div className="gh-card-header gh-console-header">
          <span>Timeline</span>
          <label className="gh-console-toggle">
            <input
              type="checkbox"
              checked={includeNoise}
              onChange={(e) => setIncludeNoise(e.target.checked)}
            />
            Show heartbeat + infra noise
          </label>
        </div>
        <div className="gh-card-body gh-console-body">
          {timelineEvents.map((event, idx) => {
            const editedPaths = extractEditedPaths(event);
            return (
              <div key={`${event.ts}-${idx}`} className="gh-console-row is-system">
                <div className="gh-console-main">
                  <div className="gh-console-topline">
                    <span>{summarizeEvent(event)}</span>
                    <span className="gh-muted">{new Date(event.ts).toLocaleString()}</span>
                  </div>
                  <div className="gh-muted gh-code" style={{ fontSize: 11 }}>{event.kind}</div>
                  {editedPaths.length ? (
                    <div className="gh-edit-paths">
                      {editedPaths.map((path) => (
                        <span key={path} className="gh-pill">{path}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!timelineEvents.length ? <div className="gh-muted">No timeline events yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
