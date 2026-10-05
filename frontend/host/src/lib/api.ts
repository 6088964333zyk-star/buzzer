const BASE = '/api';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Backend errors are {message} (BuzzerError), a string {detail} (HTTPException), or
 * a {detail} array (request validation, e.g. an upload without a file). Ported from
 * the admin app's toError (docs/design-t8-images.md Step 6).
 */
async function errorFrom(res: Response): Promise<Error> {
  const fallback = `HTTP ${res.status}`;
  const err = (await res.json().catch(() => ({}))) as { message?: unknown; detail?: unknown };
  if (typeof err.message === 'string') return new Error(err.message);
  if (typeof err.detail === 'string') return new Error(err.detail);
  if (Array.isArray(err.detail)) {
    const parts = err.detail.map((item: { loc?: unknown[]; msg?: unknown }) => {
      const msg = String(item?.msg ?? 'Invalid value');
      const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : undefined;
      return field !== undefined ? `${field}: ${msg}` : msg;
    });
    if (parts.length > 0) return new Error(parts.join('; '));
  }
  return new Error(fallback);
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

/** Multipart request: no JSON Content-Type, so the browser sets the boundary. */
async function sendForm<T>(method: 'POST' | 'PUT', path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: authHeader(), body: form });
  if (!res.ok) throw await errorFrom(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
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
  postForm: <T>(path: string, form: FormData) => sendForm<T>('POST', path, form),
  putForm: <T>(path: string, form: FormData) => sendForm<T>('PUT', path, form),
  download,
};
