const TOKEN_KEY = 'hb_token';

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY));

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

/**
 * Upload one file (pdf, jpeg, png, webp up to 10 MB). Resolves to { url, name }.
 * Files are private by default. Pass visibility 'public' for product photos and brochures.
 * Pass registration: true while signing up, before there is an account.
 */
export async function uploadFile(file, { visibility = 'private', registration = false } = {}) {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const path = registration ? '/api/uploads/registration' : `/api/uploads?visibility=${visibility}`;
  let res;
  try {
    res = await fetch(path,  { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Please try again.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
