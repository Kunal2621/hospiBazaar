import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export const inr = (n) => (n === null || n === undefined || n === '' ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const dateTimeText = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Load a GET endpoint. Returns { data, error, reload }. Pass null to skip. */
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: '' });
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return api(path).then((data) => setState({ data, error: '' })).catch((e) => setState((s) => ({ ...s, error: e.message })));
  }, [path]);
  useEffect(() => { setState({ data: null, error: '' }); load(); }, [load]);
  return { data: state.data, error: state.error, reload: load };
}
