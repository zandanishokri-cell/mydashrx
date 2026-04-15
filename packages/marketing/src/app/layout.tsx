import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MyDashRx — Pharmacy Delivery Management Platform',
  description:
    'The modern dispatch platform for independent pharmacies. Manage drivers, track deliveries, and grow your pharmacy business — all from one dashboard.',
  openGraph: {
    title: 'MyDashRx — Pharmacy Delivery Management',
    description:
      'Built for independent Michigan pharmacies. HIPAA-compliant, route-optimized, and designed to replace expensive legacy systems.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-gray-900 font-sans antialiased">{children}</body>
    </html>
  );
}
