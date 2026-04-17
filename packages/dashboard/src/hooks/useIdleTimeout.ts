import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isAuthenticated, clearSession } from '@/lib/auth';

const WARN_MS = 25 * 60_000;
const LOGOUT_MS = 30 * 60_000;
const EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

export function useIdleTimeout() {
  const router = useRouter();
  const pathname = usePathname();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(300);
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!isAuthenticated()) return;

    let warnTimer: ReturnType<typeof setTimeout>;
    let logoutTimer: ReturnType<typeof setTimeout>;
    let countdownInterval: ReturnType<typeof setInterval>;

    const doLogout = () => {
      clearInterval(countdownInterval);
      clearSession();
      // P-UX3: preserve current path so user returns to same page after re-auth
      const next = encodeURIComponent(pathname ?? '/dashboard');
      router.replace(`/login?reason=idle&next=${next}`);
    };

    const reset = () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      clearInterval(countdownInterval);
      setShowWarning(false);
      setCountdown(300);

      warnTimer = setTimeout(() => {
        setShowWarning(true);
        setCountdown(300);
        countdownInterval = setInterval(() => {
          setCountdown(s => {
            if (s <= 1) { doLogout(); return 0; }
            return s - 1;
          });
        }, 1000);
      }, WARN_MS);

      logoutTimer = setTimeout(doLogout, LOGOUT_MS);
    };

    resetRef.current = reset;
    reset();

    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      clearInterval(countdownInterval);
      EVENTS.forEach(e => window.removeEventListener(e, reset));
    };
  }, [router]);

  const extendSession = useCallback(() => resetRef.current(), []);

  return { showWarning, extendSession, countdown };
}
