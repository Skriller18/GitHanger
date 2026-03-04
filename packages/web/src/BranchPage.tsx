import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet } from './api';
import { DiffView } from './DiffView';

type Commit = { hash: string; ts: number; subject: string };

type DiffFile = {
  from: string;
  to: string;
  chunks: any[];
};

export function BranchPage() {
  const { id } = useParams();
  const params = new URLSearchParams(window.location.search);
  const branch = params.get('name') ?? '';
  const base = params.get('base') ?? 'main';

  const [commits, setCommits] = React.useState<Commit[]>([]);
  const [commitSkip, setCommitSkip] = React.useState(0);
  const [commitHasMore, setCommitHasMore] = React.useState(true);
  const COMMIT_PAGE = 10;

  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCommitSkip(0);
    setCommits([]);
    setCommitHasMore(true);
  }, [id, branch, base]);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const [c, d] = await Promise.all([
          apiGet<{ commits: Commit[] }>(
            `/api/repos/${id}/branch/commits?name=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}&limit=${COMMIT_PAGE}&skip=${commitSkip}`
          ),
          apiGet<{ files: DiffFile[] }>(
            `/api/repos/${id}/branch/diff?name=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}`
          ),
        ]);
        setCommits((prev) => (commitSkip === 0 ? c.commits : [...prev, ...c.commits]));
        setCommitHasMore(c.commits.length === COMMIT_PAGE);
        setFiles(d.files);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [id, branch, base, commitSkip]);

  if (!branch) {
    return <div style={{ color: '#666' }}>No branch specified.</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to={`/repo/${id}`} style={{ textDecoration: 'none' }}>
          ← Back to repo
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{branch}</h3>
        <div style={{ color: '#666', fontSize: 12 }}>compare vs {base}</div>
      </div>

      {err ? <div style={{ color: 'crimson', marginBottom: 12 }}>{err}</div> : null}

      <div className="gh-card" style={{ marginBottom: 16 }}>
        <div className="gh-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>Commits</span>
          {commitHasMore ? (
            <button onClick={() => setCommitSkip((s) => s + COMMIT_PAGE)}>Load more</button>
          ) : (
            <span className="gh-muted" style={{ fontSize: 12 }}>end</span>
          )}
        </div>
        <div className="gh-card-body" style={{ display: 'grid', gap: 10, maxHeight: 260, overflow: 'auto' }}>
          {commits.map((c) => (
            <div key={c.hash} style={{ fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span className="gh-code" style={{ fontWeight: 800 }}>{c.hash.slice(0, 8)}</span>
                <span style={{ fontWeight: 600 }}>{c.subject}</span>
              </div>
              <div className="gh-muted" style={{ fontSize: 11, marginTop: 4 }}>{new Date(c.ts).toLocaleString()}</div>
            </div>
          ))}
          {!commits.length ? <div className="gh-muted">No commits (or base not found).</div> : null}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Diff</div>
        <DiffView files={files as any} />
      </div>
    </div>
  );
}
