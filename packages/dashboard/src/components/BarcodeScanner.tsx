'use client';
import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { X } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | null = null;

    async function start() {
      // Fast-path: native BarcodeDetector (Chrome/Android)
      if ('BarcodeDetector' in window) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
          if (!videoRef.current) return;
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          const detector = new (window as any).BarcodeDetector({
            formats: ['code_128', 'qr_code', 'data_matrix', 'upc_a', 'upc_e'],
          });
          let running = true;
          const poll = async () => {
            if (!running || !videoRef.current) return;
            try {
              const results = await detector.detect(videoRef.current);
              if (results.length > 0) { running = false; onScan(results[0].rawValue); }
            } catch { /* frame not ready */ }
            if (running) requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
          cleanup = () => { running = false; stream.getTracks().forEach(t => t.stop()); };
          return;
        } catch { /* fall through to @zxing */ }
      }

      // Fallback: @zxing/browser (iOS Safari + desktop)
      try {
        const reader = new BrowserMultiFormatReader();
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (!devices.length) { setError('No camera found'); return; }
        const back = devices.find(d => /back|rear|environment/i.test(d.label)) ?? devices[devices.length - 1];
        if (stopped) return;
        const ctrl = await reader.decodeFromVideoDevice(back.deviceId, videoRef.current!, result => {
          if (result) { ctrl.stop(); onScan(result.getText()); }
        });
        cleanup = () => ctrl.stop();
      } catch (e: any) {
        if (!stopped) setError(e?.message ?? 'Camera access denied');
      }
    }

    start();
    return () => { stopped = true; cleanup?.(); };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-12 pb-3 text-white">
        <span className="font-bold text-lg">Scan Package Barcode</span>
        <button onClick={onClose} className="p-2"><X size={24} /></button>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center text-white text-center px-6">
          <p>{error}</p>
        </div>
      ) : (
        <div className="relative flex-1">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-40 border-2 border-white/80 rounded-lg" />
          </div>
        </div>
      )}
      <p className="text-center text-white/60 text-sm py-4">Point camera at barcode label</p>
    </div>
  );
}
