import { CookieSettingsLink } from "@/components/AnalyticsConsent";
import { siteIdentity } from "@/lib/site";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  const site = siteIdentity();
  return (
    <main className="wrap page single">
      <div className="prose">
        <h1>Privacy</h1>

        <h2>What this site is</h2>
        <p>
          {site.siteName} is an automated news aggregator. Headlines link to their original publishers. We host no
          articles of our own. Coverage is drawn from a whitelist of sources and organized with the help of automated
          tools, with light human curation.
        </p>

        <h2>Sponsored content</h2>
        <p>
          Slots labeled &ldquo;Sponsored,&rdquo; the announcement box, and featured listings in Jobs, Events, and
          Podcasts are paid placements. They are always visually marked and never influence which news stories appear
          or how they are ranked.
        </p>

        <h2>Cookies and analytics</h2>
        <p>
          We use Google Analytics to understand readership: which pages are visited and roughly where visitors come
          from. It sets cookies only if you accept the analytics banner. If you decline, no analytics run and no
          cookies are set. We collect no personal information, require no accounts, and show no advertising networks.
          A small amount of local storage is used for your own preferences (theme, clock format, link behavior), which
          never leaves your browser.
        </p>
        <p>
          <CookieSettingsLink label="Change your analytics choice" />
        </p>

        <h2>Contact</h2>
        <p>
          Questions, corrections, or source suggestions: <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </p>
      </div>
    </main>
  );
}
