import Link from "next/link";

/** Plain text wordmark: the configured site name, linking home. */
export function Wordmark({ siteName }: { siteName: string }) {
  return (
    <Link href="/" className="logo">
      {siteName}
    </Link>
  );
}
