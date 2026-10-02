'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A nav link that marks itself `aria-current="page"` on its own route and below it. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <Link href={href} aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}>
      {children}
    </Link>
  );
}
