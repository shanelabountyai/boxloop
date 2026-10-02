// public: the root shell; shows only whether someone is signed in
import Link from 'next/link';
import { signOutHere } from '@/app/account/security/actions';
import { currentSession } from '@/core/auth/session';
import { ActionForm } from '@/core/ui/action-form';
import './globals.css';

export const metadata = { title: { default: 'BoxLoop', template: '%s · BoxLoop' } };

// One header for every page, template-owned ones included. The org's own links sit under it in the org layout.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- one font for every page, set in the root layout */}
        <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="site">
          <Link href="/" className="wordmark">
            <span aria-hidden="true" />
            BoxLoop
          </Link>
          <nav aria-label="Account">
            {session ? (
              <>
                <Link href="/onboarding">Your orgs</Link>
                <Link href="/account/security">Account</Link>
                <ActionForm action={signOutHere}>
                  <button type="submit" className="link">Sign out</button>
                </ActionForm>
              </>
            ) : (
              <Link href="/login">Sign in</Link>
            )}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
