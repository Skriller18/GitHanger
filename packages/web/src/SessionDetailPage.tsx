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

type EventTone = 'success' | 'warn' | 'error' | 'system';
type DerivedState = 'running' | 'waiting' | 'blocked' | 'crashed' | 'stale';
type MilestoneKind = 'task' | 'test' | 'commit' | 'approval' | 'runtime';

type ConsoleRow =
  | { kind: 'event'; event: Event; tone: EventTone; summary: string }
  | { kind: 'heartbeat'; count: number; firstTs: number; lastTs: number };

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

function isHeartbeatEvent(e: Event): boolean {
  const k = lower(e.kind);
  const m = lower(e.message);
  return k.includes('heartbeat') || m.includes('heartbeat_ok') || m === 'heartbeat_ok' || m.includes('heartbeat');
}

function isInfraNoiseEvent(e: Event): boolean {
  const k = lower(e.kind);
  const m = lower(e.message);
  return (
    k.includes('stream_ready') ||
    k.includes('connected') ||
    k.includes('ping') ||
    m.includes('node-pty unavailable') ||
    m.includes('fallback:inherit') ||
    m.includes('post_spawn failed')
  );
}

function isErrorEvent(e: Event): boolean {
  const k = lower(e.kind);
  const m = lower(e.message);
  return (
    k.includes('error') ||
    k.includes('crash') ||
    m.includes('error') ||
    m.includes('exception') ||
    m.includes('failed')
  );
}

function isSuccessEvent(e: Event): boolean {
  const k = lower(e.kind);
  const m = lower(e.message);
  return (
    k.includes('success') ||
    k.includes('passed') ||
    k.includes('complete') ||
    k.includes('approved') ||
    m.includes('test passed') ||
    m.includes('tests passed') ||
    m.includes('completed') ||
    m.includes('approved') ||
    m.includes('commit')
  );
}

function isWarnEvent(e: Event): boolean {
  const k = lower(e.kind);
  const m = lower(e.message);
  return k.includes('approval') || k.includes('warn') || k.includes('timeout') || m.includes('waiting') || m.includes('retry');
}

function eventTone(e: Event): EventTone {
  if (isErrorEvent(e)) return 'error';
  if (isSuccessEvent(e)) return 'success';
  if (isWarnEvent(e)) return 'warn';
  return 'system';
}

function eventSummary(e: Event): string {
  if (e.kind === 'approval_required') return 'Approval required';
  if (e.kind === 'approval_decision') {
    const payload = parseJson<{ decision?: string }>(e.message);
    return `Approval ${payload?.decision ?? 'updated'}`;
  }

  const payload = parseJson<{ text?: string; detail?: string; title?: string }>(e.message);
  const message = payload?.text ?? payload?.detail ?? payload?.title ?? e.message ?? '';
  const shortMsg = message.replace(/\s+/g, ' ').trim();

  if (shortMsg) return shortMsg.length > 120 ? `${shortMsg.slice(0, 117)}...` : shortMsg;
  return e.kind.replaceAll('_', ' ');
}

function isMeaningfulEvent(e: Event): boolean {
  if (isHeartbeatEvent(e)) return false;
  if (isInfraNoiseEvent(e)) return false;
  return true;
}

function formatAge(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return '<1s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function deriveState(input: {
  session: Session;
  lastHeartbeatTs: number | null;
  lastMeaningfulTs: number | null;
  hasPendingApproval: boolean;
  now: number;
}): DerivedState {
  const { session, lastHeartbeatTs, lastMeaningfulTs, hasPendingApproval, now } = input;
  if (session.status === 'crashed') return 'crashed';
  if (session.status !== 'running') return 'waiting';

  const heartbeatAge = lastHeartbeatTs ? now - lastHeartbeatTs : Infinity;
  const meaningfulAge = lastMeaningfulTs ? now - lastMeaningfulTs : Infinity;

  if (heartbeatAge > 2 * 60_000) return 'stale';
  if (hasPendingApproval || meaningfulAge > 3 * 60_000) return 'blocked';
  if (meaningfulAge > 45_000) return 'waiting';
  return 'running';
}

function detectMilestone(e: Event): { kind: MilestoneKind; label: string } | null {
  const k = lower(e.kind);
  const m = lower(e.message);

  if (k.includes('approval_required')) return { kind: 'approval', label: 'Approval required' };
  if (k.includes('approval_decision')) return { kind: 'approval', label: 'Approval decision' };
  if (k.includes('start') || m.includes('task started') || m.includes('starting task')) return { kind: 'task', label: 'Task started' };
  if (m.includes('tests passed') || m.includes('test passed') || k.includes('test_pass')) return { kind: 'test', label: 'Tests passed' };
  if (k.includes('commit') || m.includes('commit ') || m.includes('committed')) return { kind: 'commit', label: 'Commit' };
  if (k.includes('terminate') || k.includes('stop')) return { kind: 'runtime', label: 'Runtime change' };

  return null;
}

function toneIcon(tone: EventTone): string {
  if (tone === 'success') return '✓';
  if (tone === 'warn') return '!';
  if (tone === 'error') return '✕';
  return '•';
}

export function SessionDetailPage() {
  const { id } = useParams();
  const [session, setSession] = React.useState<Session | null>(null);
  const [events, setEvents] = React.useState<Event[]>([]);
  const [repoId, setRepoId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = React.useState<ApprovalRequest | null>(null);
  const [includeHeartbeatNoise, setIncludeHeartbeatNoise] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  const sortedEvents = React.useMemo(() => [...events].sort((a, b) => b.ts - a.ts), [events]);

  const lastHeartbeatTs = React.useMemo(() => {
    const e = sortedEvents.find(isHeartbeatEvent);
    return e?.ts ?? null;
  }, [sortedEvents]);

  const meaningfulEvents = React.useMemo(() => sortedEvents.filter(isMeaningfulEvent), [sortedEvents]);

  const lastMeaningfulEvent = meaningfulEvents[0] ?? null;
  const lastMeaningfulTs = lastMeaningfulEvent?.ts ?? null;

  const derivedState = React.useMemo(() => {
    if (!session) return 'waiting' as DerivedState;
    return deriveState({
      session,
      lastHeartbeatTs,
      lastMeaningfulTs,
      hasPendingApproval: Boolean(pendingApproval),
      now,
    });
  }, [session, lastHeartbeatTs, lastMeaningfulTs, pendingApproval, now]);

  const consoleRows = React.useMemo((): ConsoleRow[] => {
    if (includeHeartbeatNoise) {
      return sortedEvents.map((event) => ({ kind: 'event', event, tone: eventTone(event), summary: eventSummary(event) }));
    }

    // Signal-only mode: hide heartbeat and infra noise entirely.
    return sortedEvents
      .filter((event) => !isHeartbeatEvent(event) && !isInfraNoiseEvent(event))
      .map((event) => ({ kind: 'event', event, tone: eventTone(event), summary: eventSummary(event) }));
  }, [includeHeartbeatNoise, sortedEvents]);

  const errorsLast15m = React.useMemo(() => {
    const cutoff = now - 15 * 60_000;
    return sortedEvents.filter((e) => e.ts >= cutoff && eventTone(e) === 'error').length;
  }, [sortedEvents, now]);

  const commandsPerMin = React.useMemo(() => {
    const lookbackMs = 10 * 60_000;
    const cutoff = now - lookbackMs;
    const commandLike = sortedEvents.filter((e) => {
      if (e.ts < cutoff) return false;
      const k = lower(e.kind);
      const m = lower(e.message);
      return k.includes('chat_user') || k.includes('command') || k.includes('exec') || m.includes('run ') || m.includes('tool');
    }).length;
    return commandLike / 10;
  }, [sortedEvents, now]);

  const stuck = Boolean(session?.status === 'running' && (!lastMeaningfulTs || now - lastMeaningfulTs > 3 * 60_000));

  const milestones = React.useMemo(() => {
    const chips: Array<{ key: string; label: string; kind: MilestoneKind; ts: number }> = [];
    const seen = new Set<string>();

    for (const e of meaningfulEvents) {
      const m = detectMilestone(e);
      if (!m) continue;
      const key = `${m.kind}:${m.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push({ key, label: m.label, kind: m.kind, ts: e.ts });
      if (chips.length >= 8) break;
    }

    return chips.sort((a, b) => b.ts - a.ts);
  }, [meaningfulEvents]);

  if (err) return <div style={{ color: 'var(--danger)' }}>{err}</div>;
  if (!session) return <div>Loading…</div>;

  const diffLink = repoId
    ? `/repo/${repoId}/wt?path=${encodeURIComponent(session.worktreePath)}`
    : `/wt?path=${encodeURIComponent(session.worktreePath)}`;

  return (
    <div className="gh-session-detail">
      <div className="gh-card gh-live-rail" style={{ marginBottom: 12 }}>
        <div className="gh-card-header">Live Status Rail</div>
        <div className="gh-card-body gh-live-rail-grid">
          <div className="gh-live-rail-item">
            <div className="gh-muted">Derived state</div>
            <div className={`gh-status-badge is-${derivedState}`}>{derivedState}</div>
          </div>
          <div className="gh-live-rail-item">
            <div className="gh-muted">Last heartbeat age</div>
            <div className="gh-code">{formatAge(lastHeartbeatTs ? now - lastHeartbeatTs : null)}</div>
          </div>
          <div className="gh-live-rail-item">
            <div className="gh-muted">Last meaningful event age</div>
            <div className="gh-code">{formatAge(lastMeaningfulTs ? now - lastMeaningfulTs : null)}</div>
          </div>
          <div className="gh-live-rail-item">
            <div className="gh-muted">Branch + pid</div>
            <div className="gh-code">{session.branch} · pid {session.pid ?? '—'}</div>
          </div>
          <div className="gh-live-rail-item gh-live-rail-item-wide">
            <div className="gh-muted">Last meaningful action</div>
            <div className="gh-code">{lastMeaningfulEvent ? eventSummary(lastMeaningfulEvent) : 'Waiting for first real agent action…'}</div>
          </div>
        </div>
      </div>

      <div className="gh-milestones" style={{ marginBottom: 12 }}>
        {milestones.length ? (
          milestones.map((m) => (
            <span key={m.key} className={`gh-milestone-chip is-${m.kind}`} title={new Date(m.ts).toLocaleString()}>
              {m.label}
            </span>
          ))
        ) : (
          <span className="gh-muted">No milestones detected yet.</span>
        )}
      </div>

      <div className="gh-grid gh-session-detail-grid gh-monitor-grid" style={{ gap: 12 }}>
        <div className="gh-card">
          <div className="gh-card-header gh-console-header">
            <span>Console Monitor</span>
            <label className="gh-console-toggle">
              <input
                type="checkbox"
                checked={includeHeartbeatNoise}
                onChange={(e) => setIncludeHeartbeatNoise(e.target.checked)}
              />
Include heartbeat + infra noise
            </label>
          </div>
          <div className="gh-card-body gh-console-body">
            {consoleRows.map((row, idx) => {
              if (row.kind === 'heartbeat') {
                return (
                  <div key={`hb-${row.firstTs}-${idx}`} className="gh-console-row is-heartbeat">
                    <div className="gh-console-leading">~</div>
                    <div>
                      Heartbeat x{row.count} collapsed
                      <span className="gh-muted"> · {new Date(row.firstTs).toLocaleTimeString()} → {new Date(row.lastTs).toLocaleTimeString()}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={`${row.event.ts}-${idx}`} className={`gh-console-row is-${row.tone}`}>
                  <div className="gh-console-leading">{toneIcon(row.tone)}</div>
                  <div className="gh-console-main">
                    <div className="gh-console-topline">
                      <span>{row.summary}</span>
                      <span className="gh-muted">{new Date(row.event.ts).toLocaleString()}</span>
                    </div>
                    <div className="gh-muted gh-code" style={{ fontSize: 11 }}>{row.event.kind}</div>
                    {row.event.message ? <pre className="gh-console-message">{row.event.message}</pre> : null}
                  </div>
                </div>
              );
            })}
            {!consoleRows.length ? <div className="gh-muted">No events yet.</div> : null}
          </div>
        </div>

        <div className="gh-grid" style={{ gap: 12, alignContent: 'start' }}>
          <div className="gh-card">
            <div className="gh-card-header">Agent Health</div>
            <div className="gh-card-body gh-health-grid">
              <div>
                <div className="gh-muted">Errors in last 15m</div>
                <div className="gh-code" style={{ fontSize: 18 }}>{errorsLast15m}</div>
              </div>
              <div>
                <div className="gh-muted">Commands / min (rolling)</div>
                <div className="gh-code" style={{ fontSize: 18 }}>{commandsPerMin.toFixed(2)}</div>
              </div>
              <div>
                <div className="gh-muted">Stuck detector</div>
                <div className={`gh-health-badge ${stuck ? 'is-bad' : 'is-good'}`}>
                  {stuck ? 'Potentially stuck (>3m)' : 'Healthy'}
                </div>
              </div>

              <div className="gh-health-actions">
                <button
                  className="gh-btn-primary"
                  disabled={session.status !== 'running' || !session.pid}
                  onClick={async () => {
                    const ok = confirm(`Restart session by terminating pid?\n\n${session.name} (pid=${session.pid ?? '—'})`);
                    if (!ok) return;
                    const res: any = await apiPost(`/api/sessions2/${session.id}/terminate`, {});
                    if (!res.ok) alert(res.message ?? res.error ?? 'restart/terminate failed');
                    window.location.reload();
                  }}
                >
                  Restart
                </button>

                <button
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

                <Link to={diffLink} className="gh-pill">
                  Open worktree diff
                </Link>
              </div>
            </div>
          </div>

          <div className="gh-card">
            <div className="gh-card-header">Session</div>
            <div className="gh-card-body">
              <div><b>Name:</b> {session.name}</div>
              <div><b>Provider:</b> {session.provider}</div>
              <div><b>Status:</b> {session.status}</div>
              <div className="gh-code gh-muted" style={{ marginTop: 8 }}>{session.worktreePath}</div>
            </div>
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
