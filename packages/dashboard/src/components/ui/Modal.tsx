'use client';
import { useEffect, useId, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}

export function Modal({ title, onClose, children, width = 'max-w-lg' }: Props) {
  const titleId = useId();
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    // Capture trigger element so focus returns on close
    triggerRef.current = document.activeElement;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      // Return focus to trigger element
      if (triggerRef.current && (triggerRef.current as HTMLElement).focus) {
        (triggerRef.current as HTMLElement).focus();
      }
    };
  }, [onClose]);

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
        <div className={`relative bg-white rounded-2xl shadow-xl w-full ${width} mx-4 max-h-[90vh] overflow-y-auto`}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 id={titleId} className="font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </FocusTrap>
  );
}
