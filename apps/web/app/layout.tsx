import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo' });

export const metadata: Metadata = {
  title: 'FORK',
  description:
    'Agents can explore any financial future. Only the branch a human signed can move money.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${archivo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
