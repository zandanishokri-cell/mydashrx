import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';
import { AuthSync } from '@/components/AuthSync';
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
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
