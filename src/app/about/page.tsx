import Link from "next/link";
import { loadSiteConfig } from "@/lib/config";
import { siteIdentity } from "@/lib/site";

export const metadata = {
  title: "About",
  description: "What this site is and how the front page gets made.",
};

/** The site's front door for a first time visitor. House style: no em dashes, no semicolons. */
export default function AboutPage() {
  const site = siteIdentity();
  const sections = loadSiteConfig().sections;
  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>About {site.siteName}</h1>
        <p>
          {site.siteName} is a front page for {site.topic}. It watches a hand picked list of sources around the clock,
          groups what they publish into stories, ranks the stories by significance and freshness, and writes a one
          sentence plain language explainer under every headline. The result is one page that answers the question
          "what is happening right now" without a feed to scroll or an account to make.
        </p>
        <h2>How it works</h2>
        <p>
          A pipeline runs around the clock. It reads the whitelisted sources and hands anything new to an editor
          model that decides what counts as news, merges coverage of the same event into one story, and files it under{" "}
          {sections.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? (i === sections.length - 1 ? " or " : ", ") : ""}
              <Link href={`/${s.id}`}>{s.title}</Link>
            </span>
          ))}
          . The rules it applies are public on the <Link href="/criteria">criteria page</Link>.
        </p>
        <p>
          Everything on the site flows from that: the <Link href="/stream">stream</Link> is the raw feed of accepted
          items, the <Link href="/day">daily archive</Link> freezes each day at UTC midnight, and clicking the date in
          the header time travels to any archived front page.
        </p>
        <h2>Follow and contact</h2>
        <p>
          {site.siteName} offers <Link href="/subscribe">daily and weekly email digests</Link>. Story suggestions come
          in through the <Link href="/submit">submit page</Link>, and anything else can be communicated to:{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </p>
      </div>
    </main>
  );
}
