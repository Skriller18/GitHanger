export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:4545';

async function parseErrorMessage(res: Response) {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    if (body.message) return body.message;
    if (body.error) return body.error;
  } catch {
    // Ignore invalid json.
  }
  return `${res.status} ${res.statusText}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return (await res.json()) as T;
}
