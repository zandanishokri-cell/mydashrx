import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';
import { AuthSync } from '@/components/AuthSync';
import { RouteAnnouncer } from '@/components/RouteAnnouncer';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora' });

export const metadata: Metadata = {
  title: 'MyDashRx — Pharmacy Delivery Management',
  description: 'AI-powered delivery dispatch for independent pharmacies',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body className="bg-[#F7F8FC] text-gray-900 font-sans antialiased">
        {/* P-A11Y7: WCAG 2.4.1 skip-to-main-content link */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded focus:text-sm focus:font-medium focus:outline-none focus:ring-2 focus:ring-white"
        >
          Skip to main content
        </a>
        <AuthSync />
        <RouteAnnouncer />
        {/* P-A11Y7: WCAG 2.4.3 — main landmark for keyboard/AT navigation */}
        <main id="main-content">
          {children}
        </main>
      </body>
    </html>
  );
}
