/** Thin client for the Rupeemap API. All business rules live on the server. */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: any,
  ) {
    super(message);
  }
  get fields(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; [k: string]: any };
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ data: T; meta?: any }> {
  let res: Response;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      // The browser sets the multipart boundary itself for FormData.
      headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), 'x-requested-with': 'rupeemap', ...headers },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', 'You appear to be offline. Check your connection and try again.', 0);
  }
  const json = await res.json().catch(() => null);
  // No JSON from a 5xx means the website could not reach the Rupeemap server at all.
  if (!json && res.status >= 500) {
    throw new ApiError(
      'SERVER_DOWN',
      'The Rupeemap server is not running or is restarting. Please try again in a minute. If Rupeemap runs on this computer, double-click START-RUPEEMAP.bat first.',
      res.status,
    );
  }
  if (!res.ok || !json?.success) {
    const err = new ApiError(json?.code ?? 'INTERNAL_ERROR', json?.message ?? 'Something went wrong. Please try again.', res.status, json?.details);
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw err;
  }
  return { data: json.data as T, meta: json.meta };
}

export const api = {
  get: async <T>(path: string, params?: Record<string, any>) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return (await call<T>('GET', path + (qs === '?' ? '' : qs))).data;
  },
  page: async <T>(path: string, params?: Record<string, any>): Promise<Paged<T>> => {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString()
      : '';
    const r = await call<T[]>('GET', path + (qs === '?' ? '' : qs));
    return { data: r.data, meta: r.meta };
  },
  post: async <T>(path: string, body?: unknown, headers?: Record<string, string>) => (await call<T>('POST', path, body ?? {}, headers)).data,
  patch: async <T>(path: string, body?: unknown, headers?: Record<string, string>) => (await call<T>('PATCH', path, body ?? {}, headers)).data,
  put: async <T>(path: string, body?: unknown) => (await call<T>('PUT', path, body ?? {})).data,
  del: async <T>(path: string) => (await call<T>('DELETE', path)).data,
  /** Multipart POST with text fields and an optional file. */
  form: async <T>(path: string, fields: Record<string, string>, file?: File | null) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append('file', file);
    return (await call<T>('POST', path, form)).data;
  },
  upload: async <T>(path: string, file: File, field = 'file') => {
    const form = new FormData();
    form.append(field, file);
    return (await call<T>('POST', path, form)).data;
  },
};

export function newIdempotencyKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random();
}
