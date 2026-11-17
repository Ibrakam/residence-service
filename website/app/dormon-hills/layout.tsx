import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { dormonBase } from './dormon-data';
import './dormon-brand.css';

export const metadata: Metadata = {
  icons: { icon: `${dormonBase}/dormon-hills/images/logo-mark.webp` },
};

export const viewport: Viewport = { themeColor: '#0e1510' };

export default function DormonLayout({ children }: { children: ReactNode }) {
  return <div className="dormon-theme">{children}</div>;
}
