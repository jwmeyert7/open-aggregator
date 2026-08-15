import { siteIdentity } from "@/lib/site";

export const metadata = {
  title: "Criteria",
  description: "The editorial criteria behind the front page.",
};

/**
 * The public, principles-level version of the editorial rulebook
 * (config/prompts/cluster.md). Keep the two honest with each other when the
 * rules change. House style for this copy: no em dashes, no semicolons.
 */
export default function CriteriaPage() {
  const site = siteIdentity();
  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>What gets on {site.siteName}</h1>
        <p>
          {site.siteName} watches a hand picked list of sources, not the open web. Primary sources carry the most
          weight.
        </p>
        <p>The rules:</p>
        <ul>
          <li>Stories must be substantively about {site.topic}.</li>
          <li>Factual reporting only, and bad news counts.</li>
          <li>Opinion is limited to essays from significant voices, always labeled opinion.</li>
          <li>Big claims rank low until corroborated.</li>
          <li>Ranking rewards corroboration, significance, centrality to the topic, and freshness.</li>
          <li>Roundups are labeled as roundups.</li>
          <li>Every story gets a one sentence plain language explainer.</li>
        </ul>
        <p>
          An editor model applies these rules to every incoming item, with human oversight. The numbers behind them
          stay private.
        </p>
        <p>
          Think a source belongs on the list? Write to <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </p>
      </div>
    </main>
  );
}
