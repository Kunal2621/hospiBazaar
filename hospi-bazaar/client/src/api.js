const TOKEN_KEY = 'hb_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'Request failed');
    this.status = status;
    this.fields = body?.fields || {};
    this.details = body?.details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Please try again.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Upload one file (pdf, jpeg, png, webp up to 10 MB). Resolves to { url, name }. */
export async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  let res;
  try {
    res = await fetch('/api/uploads', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Please try again.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
