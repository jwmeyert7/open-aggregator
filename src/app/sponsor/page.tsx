import { notFound } from "next/navigation";
import { loadState } from "@/lib/state";
import { siteIdentity } from "@/lib/site";

export const metadata = {
  title: "Sponsor",
  description: "How sponsorship works on this site, and how it stays separate from the news.",
};

/** House style for this copy: no em dashes, no semicolons. */
export default async function SponsorPage() {
  // owner opt-in via admin Layout: a fork that never sells placements should
  // not ship a page soliciting them
  if (!(await loadState()).sponsorPageEnabled) notFound();
  const site = siteIdentity();
  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Sponsor</h1>
        <p>
          {site.siteName} is for people who are interested in and working on {site.topic}. Here are ways to reach
          them.
        </p>
        <ul>
          <li>
            <strong>A post in the story list.</strong> Your headline and a line of description, sitting in the main
            column, clearly marked as sponsored.
          </li>
          <li>
            <strong>A post in the side column.</strong> The same format, in the column next to the news.
          </li>
          <li>
            <strong>The announcement line.</strong> One short line at the top of the side column, good for an event or
            a launch.
          </li>
          <li>
            <strong>A listing.</strong> An event, a job, or a podcast, listed in the side column as Sponsored Podcasts.
          </li>
        </ul>
        <h2>Our guardrails</h2>
        <ul>
          <li>Every sponsored item is labeled sponsored. Readers always know what they are looking at.</li>
          <li>Sponsorship buys a slot and nothing else. It never affects which stories get covered or how they rank.</li>
          <li>Sponsored posts sit in their own slots. They are never mixed in as if they were news.</li>
        </ul>
        <h2>Get started</h2>
        <p>
          Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> to discuss placement and pricing.
        </p>
      </div>
    </main>
  );
}
