import Link from 'next/link';

// Another org's subscription lands here too, on purpose (INV-02): "not yours" reads exactly like "not there".
export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>This page does not exist or you do not have access to it.</p>
      <p>
        <Link href="/">Back to BoxLoop</Link>
      </p>
    </main>
  );
}
