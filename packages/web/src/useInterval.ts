import * as React from 'react';

/**
 * Minimal setInterval hook.
 * Calls the latest callback at the given delay while mounted.
 */
export function useInterval(fn: () => void, delayMs: number | null) {
  const fnRef = React.useRef(fn);
  React.useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  React.useEffect(() => {
    if (delayMs == null) return;
    const id = window.setInterval(() => fnRef.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}
