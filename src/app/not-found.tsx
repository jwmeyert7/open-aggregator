import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap page single notfound roomy">
      <div className="prose">
        <h1>404</h1>
        <p>Nothing at this address. The story moved on, or the link never existed.</p>
        <p>
          <Link href="/">Back to the front page</Link>
        </p>
      </div>
    </main>
  );
}
