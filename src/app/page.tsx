// public: the landing page
import Link from 'next/link';
import { demoEnabled } from '@/core/auth/demo';
import { StatusPill } from './o/[org]/subscription-ui';

export const dynamic = 'force-dynamic'; // reads DEMO_MODE per request, never baked in at build

export default function Home() {
  return (
    <main className="home">
      <h1>Billing you can read at a glance.</h1>
      <p className="lead">
        BoxLoop runs subscriptions for a monthly hobby box: trials, renewals, retries, plan changes, pauses and cancellations. Every state shows what was
        paid, up to when, and what happens next.
      </p>
      <p className="pills">
        <StatusPill status="trialing" /> <StatusPill status="active" /> <StatusPill status="past_due" /> <StatusPill status="paused" /> <StatusPill status="pending_cancellation" />{' '}
        <StatusPill status="cancelled" />
      </p>
      <p>
        <Link href="/login" className="button primary">
          Sign in
        </Link>
      </p>
      {demoEnabled() && (
        <section className="card">
          <h2>Demo accounts</h2>
          <p className="muted">All data is synthetic and payments use a mock provider.</p>
          <p>
            <Link href="/demo" className="button">
              Choose a demo account
            </Link>
          </p>
        </section>
      )}
      <footer>
        <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/terms">Terms</Link>
      </footer>
    </main>
  );
}
