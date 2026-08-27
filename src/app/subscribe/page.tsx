import { SubscribeForm } from "./SubscribeForm";

export const metadata = {
  title: "Email digests",
  description:
    "The front page by email: a daily edition at UTC midnight, a weekly edition on Saturday morning, and a monthly edition on the 1st.",
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
        <p>Subscribe to receive an email digest every day, week or month.</p>
        <p>
          See what you would get before you sign up: a <a href="/subscribe/sample/daily">sample daily edition</a>, a{" "}
          <a href="/subscribe/sample/weekly">sample weekly edition</a>, and a{" "}
          <a href="/subscribe/sample/monthly">sample monthly edition</a>, each the most recent one sent.
        </p>
        <SubscribeForm />
      </div>
    </main>
  );
}
