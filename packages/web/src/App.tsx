import React from 'react';
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
} from 'react-router-dom';
import './App.css';
import { apiGet, apiPost } from './api';
import { DiffView } from './DiffView';
import { SessionsPage } from './SessionsPage';
import { SessionDetailPage } from './SessionDetailPage';
import { BranchPage } from './BranchPage';

type Repo = { id: string; name: string; path: string };

type Worktree = {
  path: string;
  branch: string | null;
  head: string | null;
  locked: boolean;
  prunable: boolean;
  dirtyCount: number;
  isManaged?: boolean;
};

type Commit = { hash: string; ts: number; subject: string };

type DiffFile = {
  from: string;
  to: string;
  chunks: any[];
};

export default function App() {
  return (
    <BrowserRouter>
      <div className="gh-container">
        <TopBar />

        <Routes>
          <Route path="/" element={<ReposPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/session/:id" element={<SessionDetailPage />} />
          <Route path="/repo/:id" element={<RepoPage />} />
          <Route path="/repo/:id/wt" element={<WorktreePage />} />
          <Route path="/repo/:id/branch" element={<BranchPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function TopBar() {
  const matchRepo = useMatch('/repo/:id/*');
  const repoId = matchRepo?.params?.id;
  const location = useLocation();

  const [me, setMe] = React.useState<{ branch: string; dirty: boolean } | null>(null);

  React.useEffect(() => {
    (async () => {
      if (!repoId) {
        setMe(null);
        return;
      }
      try {
        const m = await apiGet<{ ok: true; branch: string; dirty: boolean }>(`/api/repos/${repoId}/me`);
        setMe({ branch: m.branch, dirty: m.dirty });
      } catch {
        setMe(null);
      }
    })();
    // re-fetch on path change within repo pages so the header stays fresh after jump.
  }, [repoId, location.pathname]);

  return (
    <div className="gh-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/" style={{ fontWeight: 900, fontSize: 18 }}>
          GitHanger
        </Link>
        <span className="gh-muted" style={{ fontSize: 13 }}>
          local dashboard
        </span>

        {repoId && me ? (
          <span className="gh-pill" title="Current branch in your 'me' worktree">
            me: {me.branch}{' '}
            {me.dirty ? <span style={{ color: 'var(--warn)' }}>(dirty)</span> : <span style={{ color: 'var(--accent2)' }}>(clean)</span>}
          </span>
        ) : null}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link to="/">Repos</Link>
          <Link to="/sessions">Sessions</Link>
        </div>
      </div>
    </div>
  );
}

function ReposPage() {
  const [repos, setRepos] = React.useState<Repo[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const [name, setName] = React.useState('');
  const [path, setPath] = React.useState('');

  async function refresh() {
    setErr(null);
    try {
      const data = await apiGet<{ repos: Repo[] }>('/api/repos');
      setRepos(data.repos);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiPost('/api/repos', { name, path });
      setName('');
      setPath('');
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  return (
    <div>
      <h3 style={{ margin: '8px 0 12px' }}>Repos</h3>

      <form onSubmit={onAdd} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, marginBottom: 16 }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="/path/to/repo" value={path} onChange={(e) => setPath(e.target.value)} />
        <button type="submit" className="gh-btn-primary">Add repo</button>
      </form>

      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div className="gh-grid">
        {repos.map((r) => (
          <Link key={r.id} to={`/repo/${r.id}`} className="gh-card gh-row-hover" style={{ display: 'block' }}>
            <div className="gh-card-body">
              <div style={{ fontWeight: 900 }}>{r.name}</div>
              <div className="gh-code gh-muted" style={{ marginTop: 6 }}>
                {r.path}
              </div>
            </div>
          </Link>
        ))}
        {!repos.length ? <div className="gh-muted">No repos registered yet.</div> : null}
      </div>
    </div>
  );
}

function RepoPage() {
  const { id } = useParams();
  const [repo, setRepo] = React.useState<Repo | null>(null);
  const [worktrees, setWorktrees] = React.useState<Worktree[]>([]);
  const [sessions, setSessions] = React.useState<any[]>([]);
  const [branches, setBranches] = React.useState<Array<{ name: string; upstream: string | null; isHead: boolean }>>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const data = await apiGet<{ repo: Repo; worktrees: Worktree[] }>(`/api/repos/${id}/worktrees`);
        setRepo(data.repo);
        setWorktrees(data.worktrees);

        const [s, b] = await Promise.all([
          apiGet<{ sessions: any[] }>(`/api/sessions2?repoPath=${encodeURIComponent(data.repo.path)}`),
          apiGet<{ branches: Array<{ name: string; upstream: string | null; isHead: boolean }> }>(`/api/repos/${id}/branches`),
        ]);
        setSessions(s.sessions);
        setBranches(b.branches);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [id]);

  if (err) return <div style={{ color: 'crimson' }}>{err}</div>;
  if (!repo) return <div>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div className="gh-title">{repo.name}</div>
        <div className="gh-code gh-subtitle" style={{ maxWidth: 820, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {repo.path}
        </div>
      </div>

      {/* me branch status is shown in the global header */}

      <div className="gh-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
        <div className="gh-card">
          <div className="gh-card-header">Agent sessions</div>
          <div className="gh-card-body" style={{ display: 'grid', gap: 10, minHeight: 120 }}>
            {sessions.map((s) => (
              <Link key={s.id} to={`/session/${s.id}`} className="gh-row-hover" style={{ padding: 10, borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      {s.name} <span className="gh-muted" style={{ fontWeight: 600 }}>({s.provider})</span>
                    </div>
                    <div className="gh-muted gh-code" style={{ marginTop: 4 }}>{s.branch}</div>
                  </div>
                  <div style={{ color: s.status === 'running' ? 'var(--accent2)' : s.status === 'crashed' ? 'var(--danger)' : 'var(--muted)', fontWeight: 800 }}>
                    {s.status}
                  </div>
                </div>
              </Link>
            ))}
            {!sessions.length ? <div className="gh-muted">No sessions for this repo yet.</div> : null}
          </div>
        </div>

        <div className="gh-card">
          <div className="gh-card-header">Branches</div>
          <div className="gh-card-body" style={{ display: 'grid', gap: 8, maxHeight: 280, overflow: 'auto' }}>
            {branches.map((b) => (
              <Link
                key={b.name}
                to={`/repo/${repo.id}/branch?name=${encodeURIComponent(b.name)}&base=main`}
                className="gh-row-hover"
                style={{ padding: 10, borderRadius: 10 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="gh-code" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </div>
                    {b.upstream ? <div className="gh-muted" style={{ fontSize: 12, marginTop: 4 }}>upstream: {b.upstream}</div> : null}
                  </div>
                  <div className="gh-muted" style={{ fontSize: 12, fontWeight: 800 }}>{b.isHead ? 'HEAD' : ''}</div>
                </div>
              </Link>
            ))}
            {!branches.length ? <div className="gh-muted">No local branches found.</div> : null}
          </div>
        </div>
      </div>

      <div className="gh-card">
        <div className="gh-card-header">Worktrees</div>
        <div style={{ overflow: 'auto' }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th style={{ width: '70%' }}>Worktree</th>
                <th style={{ width: 120 }}>Dirty</th>
                <th style={{ width: 120 }}>Jump</th>
                <th style={{ width: 120 }}>Open</th>
                <th style={{ width: 120 }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {worktrees.map((wt) => (
                <tr key={wt.path} className="gh-row-hover">
                  <td>
                    <div className="gh-code" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 900 }}>
                      {wt.path}
                    </div>
                    <div className="gh-muted" style={{ marginTop: 4, fontSize: 12 }}>
                      {wt.branch ?? '(detached HEAD)'}
                    </div>
                  </td>
                  <td style={{ fontWeight: 800 }}>{wt.dirtyCount}</td>
                  <td>
                    <button
                      className="gh-btn-primary"
                      disabled={!wt.branch}
                      onClick={async () => {
                        if (!wt.branch) return;
                        try {
                          const res: any = await apiPost(`/api/repos/${repo.id}/jump`, { branch: wt.branch });
                          // TODO: replace with toast
                          alert(res.applyError ? `Jumped, but stash apply failed: ${res.applyError}` : `Jumped me to ${wt.branch}`);
                        } catch (e: any) {
                          alert(e.message ?? String(e));
                        }
                      }}
                    >
                      Jump
                    </button>
                  </td>
                  <td>
                    <Link to={`/repo/${repo.id}/wt?path=${encodeURIComponent(wt.path)}`} className="gh-pill">
                      View
                    </Link>
                  </td>
                  <td>
                    {wt.isManaged ? (
                      <button
                        onClick={async () => {
                          const ok = confirm(`Remove worktree?\n\n${wt.path}`);
                          if (!ok) return;
                          try {
                            await apiPost(`/api/repos/${repo.id}/worktrees/remove`, { path: wt.path });
                            // refresh list
                            const data = await apiGet<{ repo: Repo; worktrees: Worktree[] }>(`/api/repos/${repo.id}/worktrees`);
                            setWorktrees(data.worktrees);
                          } catch (e: any) {
                            alert(e.message ?? String(e));
                          }
                        }}
                        style={{ background: 'rgba(239, 68, 68, 0.14)', borderColor: 'rgba(239, 68, 68, 0.35)' }}
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="gh-muted" style={{ fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WorktreePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const wtPath = params.get('path') ?? '';

  const [commits, setCommits] = React.useState<Commit[]>([]);
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [filesCached, setFilesCached] = React.useState<DiffFile[]>([]);
  const [info, setInfo] = React.useState<{ branch: string; upstream: string | null; ahead: number; behind: number; lastPushTime: number | null } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  async function refreshAll() {
    setErr(null);
    try {
      const [c, d, s, i] = await Promise.all([
        apiGet<{ commits: Commit[] }>(`/api/commits?worktreePath=${encodeURIComponent(wtPath)}&limit=50`),
        apiGet<{ files: DiffFile[] }>(`/api/diff?worktreePath=${encodeURIComponent(wtPath)}`),
        apiGet<{ files: DiffFile[] }>(`/api/diff?worktreePath=${encodeURIComponent(wtPath)}&cached=true`),
        apiGet<{ ok: true; branch: string; upstream: string | null; ahead: number; behind: number; lastPushTime: number | null }>(
          `/api/worktree/info?repoId=${encodeURIComponent(id ?? '')}&worktreePath=${encodeURIComponent(wtPath)}`
        ),
      ]);
      setCommits(c.commits);
      setFiles(d.files);
      setFilesCached(s.files);
      setInfo({ branch: i.branch, upstream: i.upstream, ahead: i.ahead, behind: i.behind, lastPushTime: i.lastPushTime });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  React.useEffect(() => {
    refreshAll();
  }, [wtPath]);

  return (
    <div>
      <button onClick={() => nav(`/repo/${id}`)} style={{ marginBottom: 12 }}>
        ← Back
      </button>

      <div className="gh-card" style={{ marginBottom: 12 }}>
        <div className="gh-card-body" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 900 }}>Worktree</div>
            <div className="gh-code gh-muted" style={{ marginTop: 6 }}>{wtPath}</div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {info ? (
              <span className="gh-pill">
                {info.branch} · {info.behind} behind / {info.ahead} ahead
              </span>
            ) : null}
            {info?.upstream ? <span className="gh-pill">upstream: {info.upstream}</span> : <span className="gh-pill">no upstream</span>}
            {typeof info?.lastPushTime === 'number' ? (
              <span className="gh-pill">last push: {new Date(info.lastPushTime).toLocaleString()}</span>
            ) : null}
          </div>
        </div>
      </div>

      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div className="gh-card" style={{ marginBottom: 12 }}>
        <div className="gh-card-header">Git actions</div>
        <div className="gh-card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="gh-btn-primary"
            onClick={async () => {
              await apiPost('/api/worktree/stage', { repoId: id, worktreePath: wtPath });
              await refreshAll();
            }}
          >
            Stage all
          </button>

          <button
            onClick={async () => {
              const message = prompt('Commit message:');
              if (!message) return;
              await apiPost('/api/worktree/commit', { repoId: id, worktreePath: wtPath, message });
              await refreshAll();
            }}
          >
            Commit
          </button>

          <button
            onClick={async () => {
              await apiPost('/api/worktree/pull', { repoId: id, worktreePath: wtPath });
              await refreshAll();
            }}
          >
            Pull
          </button>

          <button
            onClick={async () => {
              await apiPost('/api/worktree/push', { repoId: id, worktreePath: wtPath });
              await refreshAll();
            }}
          >
            Push
          </button>
        </div>
      </div>

      <div className="gh-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
        <div className="gh-card">
          <div className="gh-card-header">Recent commits</div>
          <div className="gh-card-body" style={{ display: 'grid', gap: 8 }}>
            {commits.map((c) => (
              <div key={c.hash} style={{ fontSize: 12 }}>
                <span className="gh-code">{c.hash.slice(0, 8)}</span>
                <span style={{ marginLeft: 8 }}>{c.subject}</span>
              </div>
            ))}
            {!commits.length ? <div className="gh-muted">No commits found.</div> : null}
          </div>
        </div>

        <div className="gh-card">
          <div className="gh-card-header">Diff summary</div>
          <div className="gh-card-body">
            <div className="gh-muted" style={{ fontSize: 12 }}>Uncommitted files: {files.length}</div>
            <div className="gh-muted" style={{ fontSize: 12 }}>Staged files: {filesCached.length}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Uncommitted diff</div>
        <DiffView files={files as any} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Staged diff</div>
        <DiffView files={filesCached as any} />
      </div>
    </div>
  );
}
