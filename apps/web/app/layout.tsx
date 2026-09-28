import type { Metadata, Viewport } from 'next';
import { Archivo, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Archivo({ subsets: ['latin'], variable: '--font-display', weight: ['600', '700', '800'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Rupeemap CRM', template: '%s · Rupeemap CRM' },
  description: 'Loan DSA and channel partner CRM',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111412',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${display.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
