import { useCallback, useEffect, useState,useRef } from 'react';
import { api } from './api.js';

export const inr = (n) => (n === null || n === undefined || n === '' ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const dateTimeText = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Run fn when the tab regains focus and every 20 seconds while visible, so screens stay current. */
export function useAutoRefresh(fn, ms = 20000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const run = () => { if (!document.hidden) ref.current(); };
    const t = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', run); window.removeEventListener('focus', run); };
  }, [ms]);
}

/** Load a GET endpoint. Returns { data, error, reload }. Pass null to skip. */
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: '' });
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return api(path).then((data) => setState({ data, error: '' })).catch((e) => setState((s) => ({ ...s, error: e.message })));
  }, [path]);
  useEffect(() => { setState({ data: null, error: '' }); load(); }, [load]);
  useAutoRefresh(load);
  return { data: state.data, error: state.error, reload: load };
}
