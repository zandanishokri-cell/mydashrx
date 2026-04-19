'use client';
// P-CNV13: Social proof trust block for pharmacy signup page
// Rotating testimonials + HIPAA badge + stats — drives conversion before first keystroke
import { useState, useEffect } from 'react';

const TESTIMONIALS = [
  { quote: 'Set up in under an hour. Our drivers love the app.', author: 'Owner, community pharmacy — Detroit, MI' },
  { quote: 'Cut our delivery coordination time by 70%. Worth every penny.', author: 'Pharmacist, independent pharmacy — Chicago, IL' },
  { quote: 'HIPAA compliance was our biggest concern. MyDashRx nailed it.', author: 'Director of Operations, pharmacy group — Nashville, TN' },
  { quote: 'Finally a system built for independent pharmacies, not big chains.', author: 'Owner, compounding pharmacy — Austin, TX' },
];

export function SignupTrustBlock() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % TESTIMONIALS.length), 4000);
    return () => clearInterval(t);
  }, []);

  const t = TESTIMONIALS[idx];

  return (
    <div className="w-full max-w-lg mb-5">
      {/* Stats row */}
      <div className="flex items-center justify-center gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-flex items-center justify-center w-5 h-5 bg-green-100 rounded-full text-green-600 font-bold text-[10px]">✓</span>
          HIPAA-compliant
        </div>
        <div className="w-px h-3 bg-gray-200" />
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-100 rounded-full text-blue-600 font-bold text-[10px]">BAA</span>
          BAA available
        </div>
        <div className="w-px h-3 bg-gray-200" />
        <div className="text-xs text-gray-500 font-medium">50+ pharmacies live</div>
        <div className="w-px h-3 bg-gray-200" />
        <div className="text-xs text-gray-500">Avg approval &lt;2 hrs</div>
      </div>

      {/* Rotating testimonial */}
      <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm transition-all duration-300">
        <p className="text-xs text-gray-600 italic leading-relaxed mb-2">&ldquo;{t.quote}&rdquo;</p>
        <p className="text-[10px] text-gray-400 font-medium">{t.author}</p>
      </div>
    </div>
  );
}
