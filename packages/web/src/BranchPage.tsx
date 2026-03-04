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
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setErr(null);
      try {
        const [c, d] = await Promise.all([
          apiGet<{ commits: Commit[] }>(
            `/api/repos/${id}/branch/commits?name=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}&limit=100`
          ),
          apiGet<{ files: DiffFile[] }>(
            `/api/repos/${id}/branch/diff?name=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}`
          ),
        ]);
        setCommits(c.commits);
        setFiles(d.files);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [id, branch, base]);

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

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Commits ({commits.length})</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {commits.map((c) => (
            <div key={c.hash} style={{ fontSize: 12 }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{c.hash.slice(0, 8)}</span>
              <span style={{ marginLeft: 8 }}>{c.subject}</span>
            </div>
          ))}
          {!commits.length ? <div style={{ color: '#666' }}>No commits (or base not found).</div> : null}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Diff</div>
        <DiffView files={files as any} />
      </div>
    </div>
  );
}
