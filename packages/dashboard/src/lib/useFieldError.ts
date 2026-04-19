'use client';
import { useId } from 'react';

/**
 * P-A11Y20 — WCAG 3.3.1 Level A + 4.1.3 Level AA
 * Always-in-DOM error region — live region must exist before text is inserted
 * so screen readers announce it. Opacity-transparent when empty.
 *
 * Usage:
 *   const fe = useFieldError(emailError);
 *   <input {...fe.inputProps} />
 *   <p {...fe.errorProps}>{emailError}</p>
 */
export function useFieldError(message: string) {
  const id = useId();
  const hasError = !!message;
  return {
    errorId: id,
    inputProps: {
      'aria-describedby': id,
      'aria-invalid': hasError as boolean | undefined,
    },
    errorProps: {
      id,
      role: 'alert' as const,
      'aria-live': 'polite' as const,
      'aria-atomic': true,
      className: `text-xs mt-1 transition-opacity ${hasError ? 'text-red-500 opacity-100' : 'opacity-0 pointer-events-none select-none'}`,
    },
  };
}
