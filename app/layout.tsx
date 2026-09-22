import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AuraMed | Clinical Patient Intelligence & Telehealth',
  description: 'High-security clinician portal and patient telemetry system',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-800 antialiased selection:bg-emerald-500/20 selection:text-emerald-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}