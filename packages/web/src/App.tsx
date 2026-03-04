import React from 'react';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import './App.css';
import { apiGet, apiPost } from './api';
import { DiffView } from './DiffView';

type Repo = { id: string; name: string; path: string };

type Worktree = {
  path: string;
  branch: string | null;
  head: string | null;
  locked: boolean;
  prunable: boolean;
  dirtyCount: number;
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
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: 'none', color: '#111' }}>
            GitHanger
          </Link>
          <span style={{ color: '#666' }}>local dashboard</span>
        </div>

        <Routes>
          <Route path="/" element={<ReposPage />} />
          <Route path="/repo/:id" element={<RepoPage />} />
          <Route path="/repo/:id/wt" element={<WorktreePage />} />
        </Routes>
      </div>
    </BrowserRouter>
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

      <form onSubmit={onAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <input placeholder="/path/to/repo" value={path} onChange={(e) => setPath(e.target.value)} style={{ flex: 2 }} />
        <button type="submit">Add</button>
      </form>

      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div style={{ display: 'grid', gap: 8 }}>
        {repos.map((r) => (
          <Link
            key={r.id}
            to={`/repo/${r.id}`}
            style={{
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: 12,
              textDecoration: 'none',
              color: '#111',
            }}
          >
            <div style={{ fontWeight: 700 }}>{r.name}</div>
            <div style={{ color: '#666', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
              {r.path}
            </div>
          </Link>
        ))}
        {!repos.length ? <div style={{ color: '#666' }}>No repos registered yet.</div> : null}
      </div>
    </div>
  );
}

function RepoPage() {
  const { id } = useParams();
  const [repo, setRepo] = React.useState<Repo | null>(null);
  const [worktrees, setWorktrees] = React.useState<Worktree[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const data = await apiGet<{ repo: Repo; worktrees: Worktree[] }>(`/api/repos/${id}/worktrees`);
        setRepo(data.repo);
        setWorktrees(data.worktrees);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [id]);

  if (err) return <div style={{ color: 'crimson' }}>{err}</div>;
  if (!repo) return <div>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: '8px 0 12px' }}>{repo.name}</h3>
        <div style={{ color: '#666', fontSize: 12 }}>{repo.path}</div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 120px', gap: 0, padding: '10px 12px', background: '#fafafa', borderBottom: '1px solid #eee', fontWeight: 600 }}>
          <div>Worktree / Branch</div>
          <div>Dirty files</div>
          <div>Open</div>
        </div>
        {worktrees.map((wt) => (
          <div key={wt.path} style={{ display: 'grid', gridTemplateColumns: '1fr 180px 120px', padding: '10px 12px', borderBottom: '1px solid #f1f1f1' }}>
            <div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>{wt.path}</div>
              <div style={{ color: '#666', marginTop: 4 }}>{wt.branch ?? '(detached HEAD)'}</div>
            </div>
            <div>{wt.dirtyCount}</div>
            <div>
              <Link to={`/repo/${repo.id}/wt?path=${encodeURIComponent(wt.path)}`}>View</Link>
            </div>
          </div>
        ))}
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
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const [c, d, s] = await Promise.all([
          apiGet<{ commits: Commit[] }>(`/api/commits?worktreePath=${encodeURIComponent(wtPath)}&limit=50`),
          apiGet<{ files: DiffFile[] }>(`/api/diff?worktreePath=${encodeURIComponent(wtPath)}`),
          apiGet<{ files: DiffFile[] }>(`/api/diff?worktreePath=${encodeURIComponent(wtPath)}&cached=true`),
        ]);
        setCommits(c.commits);
        setFiles(d.files);
        setFilesCached(s.files);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [wtPath]);

  return (
    <div>
      <button onClick={() => nav(`/repo/${id}`)} style={{ marginBottom: 12 }}>
        ← Back
      </button>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700 }}>Worktree</div>
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, color: '#666' }}>{wtPath}</div>
      </div>

      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent commits</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {commits.map((c) => (
              <div key={c.hash} style={{ fontSize: 12 }}>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{c.hash.slice(0, 8)}</span>
                <span style={{ marginLeft: 8 }}>{c.subject}</span>
              </div>
            ))}
            {!commits.length ? <div style={{ color: '#666' }}>No commits found.</div> : null}
          </div>
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Diff summary</div>
          <div style={{ fontSize: 12, color: '#666' }}>Uncommitted files: {files.length}</div>
          <div style={{ fontSize: 12, color: '#666' }}>Staged files: {filesCached.length}</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Uncommitted diff</div>
        <DiffView files={files as any} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Staged diff</div>
        <DiffView files={filesCached as any} />
      </div>
    </div>
  );
}
