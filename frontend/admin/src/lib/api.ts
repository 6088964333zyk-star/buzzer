const BASE = '/api';

/**
 * Backend errors are {message} (BuzzerError), a string {detail} (HTTPException), or
 * a {detail} array (request validation). Extends the host app's errorFrom with the
 * array case, e.g. "title: Field required".
 */
async function toError(res: Response): Promise<Error> {
  const fallback = `HTTP ${res.status}`;
  let body: { message?: unknown; detail?: unknown };
  try {
    body = await res.json();
  } catch {
    return new Error(fallback); // not JSON, e.g. an nginx 502 page
  }
  if (typeof body?.message === 'string') return new Error(body.message);
  if (typeof body?.detail === 'string') return new Error(body.detail);
  if (Array.isArray(body?.detail)) {
    const parts = body.detail.map((item: { loc?: unknown[]; msg?: unknown }) => {
      const msg = String(item?.msg ?? 'Invalid value');
      const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : undefined;
      return field !== undefined ? `${field}: ${msg}` : msg;
    });
    if (parts.length > 0) return new Error(parts.join('; '));
  }
  return new Error(fallback);
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    throw await toError(res);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Trigger a file download from a fetch response */
async function downloadFetch(path: string): Promise<void> {
  const token = localStorage.getItem('token');
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw await toError(res);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  /** POST multipart/form-data (for file uploads) */
  postForm: <T>(path: string, form: FormData) => {
    const token = localStorage.getItem('token');
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        throw await toError(res);
      }
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    });
  },
  download: downloadFetch,
};
