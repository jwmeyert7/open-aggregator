import { SubscribeForm } from "./SubscribeForm";

export const metadata = {
  title: "Email digests",
  description: "The front page by email: a daily edition at UTC midnight and a weekly edition on Saturday morning.",
};

/** House style for this copy: no em dashes, no semicolons. */
export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ unsubscribed?: string; confirmed?: string }>;
}) {
  const { unsubscribed, confirmed } = await searchParams;
  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Email digests</h1>
        {unsubscribed ? <p className="notice">You are unsubscribed. No more emails from us.</p> : null}
        {confirmed ? <p className="notice">Subscription confirmed. See you in the next edition.</p> : null}
        <p>
          Two editions, both built from the site&apos;s frozen archives rather than a separate newsletter pipeline. The
          daily edition is the day&apos;s top stories as they freeze at UTC midnight, the same page that lives in the
          daily archive. The weekly edition arrives Saturday morning with the biggest stories of the week just ended,
          ready to read over the weekend.
        </p>
        <p>
          See what you would get before you sign up: a <a href="/subscribe/sample/daily">sample daily edition</a> and
          a <a href="/subscribe/sample/weekly">sample weekly edition</a>, each the most recent one sent.
        </p>
        <SubscribeForm />
        <p>
          One email per edition, an unsubscribe link in every footer, and your address is never shared or used for
          anything else.
        </p>
      </div>
    </main>
  );
}
