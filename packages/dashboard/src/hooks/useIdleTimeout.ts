import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isAuthenticated, clearSession, getUser } from '@/lib/auth';

// P-SES19: role-adaptive idle timeout — ONC 170.315(d)(5) + HIPAA §164.312(a)(2)(iii)
// ePHI roles (pharmacy_admin, dispatcher) → 10min logout / 9min warn
// Other roles → 30min logout / 25min warn
const PHI_ROLES = new Set(['pharmacy_admin', 'dispatcher']);
function getTimeouts() {
  const role = getUser()?.role ?? '';
  return PHI_ROLES.has(role)
    ? { warn: 9 * 60_000, logout: 10 * 60_000, countdown: 60 }
    : { warn: 25 * 60_000, logout: 30 * 60_000, countdown: 300 };
}

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
      // P-SES19: recalculate timeouts on each reset to pick up role at actual call time
      const { warn, logout, countdown: initialCountdown } = getTimeouts();
      setCountdown(initialCountdown);

      warnTimer = setTimeout(() => {
        const { countdown: c } = getTimeouts();
        setShowWarning(true);
        setCountdown(c);
        countdownInterval = setInterval(() => {
          setCountdown(s => {
            if (s <= 1) { doLogout(); return 0; }
            return s - 1;
          });
        }, 1000);
      }, warn);

      logoutTimer = setTimeout(doLogout, logout);
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
