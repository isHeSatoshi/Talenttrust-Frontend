import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import './globals.css';
import { Header } from '@/components/Header';
import { site, explorerUrl, apiDocsUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: { default: 'TalentTrust | Milestone escrow on Stellar', template: '%s | TalentTrust' },
  description:
    'TalentTrust lets clients and freelancers lock payments in a Soroban smart contract, release funds milestone by milestone, resolve disputes and build on-chain reputation.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request CSP nonce, set by src/proxy.ts. Next reads it here and
  // stamps it onto the script tags it generates, which is what lets the policy
  // avoid 'unsafe-inline' in script-src.
  //
  // Pattern for any future inline script: give it the same nonce.
  //   <script nonce={nonce} dangerouslySetInnerHTML={{ __html: '…' }} />
  // An inline script without it is blocked by the policy.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <div>
              <strong style={{ color: 'var(--text)' }}>TalentTrust</strong> &middot; {site.tagline}
            </div>
            <div className="footer-links">
              <Link href="/docs">Docs</Link>
              <a href={apiDocsUrl} target="_blank" rel="noreferrer">
                API
              </a>
              <a href={explorerUrl} target="_blank" rel="noreferrer">
                Contract
              </a>
              <a href={site.github} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </div>
          </div>
        </footer>
        {/* Carries the nonce so the pattern above has a live, lintable example. */}
        <script
          nonce={nonce}
          type="application/json"
          id="hy-csp-nonce-probe"
          dangerouslySetInnerHTML={{ __html: '{"csp":"nonce-based"}' }}
        />
      </body>
    </html>
  );
}
