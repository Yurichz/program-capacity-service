import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Result } from './types';

export function useResource<T>(
  path: string | null,
  revision = 0,
  read?: (path: string, signal: AbortSignal) => Promise<Result<T>>,
) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path);
  const control = useRef<AbortController | null>(null);
  const lastRevision = useRef(revision);
  const reload = useCallback(async () => {
    if (!path || control.current) return;
    const controller = new AbortController();
    control.current = controller;
    try {
      const value = await (read
        ? read(path, controller.signal)
        : api<T>(path, { signal: controller.signal }));
      if (!controller.signal.aborted) {
        setResult(value);
        setError(null);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      if (control.current === controller) control.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path, read]);
  useEffect(() => {
    setResult(null);
    setError(null);
    setLoading(!!path);
    void reload();
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 10000);
    const focus = () => {
      if (!document.hidden) void reload();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      control.current?.abort();
      control.current = null;
    };
  }, [reload]);
  useEffect(() => {
    if (lastRevision.current !== revision) {
      lastRevision.current = revision;
      control.current?.abort();
      control.current = null;
      void reload();
    }
  }, [revision, reload]);

  return {
    result,
    data: result?.data,
    meta: result?.meta,
    error,
    loading,
    reload,
  };
}
