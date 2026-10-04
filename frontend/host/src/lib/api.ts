const BASE = '/api';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Backend errors are {message} (BuzzerError) or {detail} (FastAPI/HTTPException). */
async function errorFrom(res: Response): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string; detail?: unknown };
  const detail = typeof err.detail === 'string' ? err.detail : undefined;
  return new Error(err.message ?? detail ?? `HTTP ${res.status}`);
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) throw await errorFrom(res);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function withBody(method: string, body?: unknown): RequestInit {
  return { method, body: body !== undefined ? JSON.stringify(body) : undefined };
}

/**
 * Download an authenticated file (CSV/HTML export). A plain <a href> can't send
 * the Bearer header, so fetch it as a blob and save it under the server's name.
 */
async function download(path: string, fallbackName = 'download'): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeader() });
  if (!res.ok) throw await errorFrom(res);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, withBody('POST', body)),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, withBody('PUT', body)),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, withBody('PATCH', body)),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  download,
};
