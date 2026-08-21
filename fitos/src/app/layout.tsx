import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Stride Guide FitOS',
  description: 'Retail footwear fitting intelligence',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/kiosk/icon-180.png', icon: '/kiosk/icon-192.png' },
  // iOS 12 reads these legacy keys and ignores the manifest's display mode, so
  // both have to be present for "Add to Home Screen" to open without browser
  // chrome. /kiosk emits its own head and does not inherit this layout — this
  // is here so the associate app is installable on the same terms.
  appleWebApp: { capable: true, title: 'Stride Guide', statusBarStyle: 'black-translucent' },
};

/**
 * There was no viewport meta at all, so Next was supplying its default. Stated
 * explicitly now, with viewport-fit=cover so env(safe-area-inset-*) resolves on
 * hardware that has insets.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F5C5B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
