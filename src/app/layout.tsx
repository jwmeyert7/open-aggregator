import type { Metadata } from "next";
import Link from "next/link";
import { AdminLink } from "@/components/AdminLink";
import { AnalyticsConsent } from "@/components/AnalyticsConsent";
import { loadSiteConfig, siteUrl } from "@/lib/config";
import { siteIdentity } from "@/lib/site";
import { loadState } from "@/lib/state";
import { HeaderStatus } from "@/components/HeaderStatus";
import { LinkPrefToggle } from "@/components/LinkPrefToggle";
import { MainNav } from "@/components/MainNav";
import { SearchBox } from "@/components/SearchBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";
import "./globals.css";

export function generateMetadata(): Metadata {
  const site = siteIdentity();
  const description = `${site.siteName}: an automated news front page. Curated aggregation from handpicked sources, with a plain-language explainer on every story.`;
  return {
    // absolute base for og:image and friends; without it Next falls back to the
    // deployment's vercel.app URL and social cards point off-brand
    metadataBase: new URL(siteUrl()),
    title: { default: `${site.siteName} · ${site.tagline}`, template: `%s · ${site.siteName}` },
    description,
    openGraph: {
      title: `${site.siteName} · ${site.tagline}`,
      description,
      url: "/",
      siteName: site.siteName,
      type: "website",
    },
    twitter: { card: "summary_large_image" },
  };
}

const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;if(localStorage.getItem("space")==="1"){document.documentElement.dataset.space="on"}}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // best-effort state read for owner toggles (sponsor link); a failed read
  // must never take the whole site down with it
  const sponsorOn = await loadState()
    .then((st) => Boolean(st.sponsorPageEnabled))
    .catch(() => false);
  const site = siteIdentity();
  const sections = loadSiteConfig().sections;
  const xHandle = site.social?.xHandle;
  const fcHandle = site.social?.farcasterHandle;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        {/* one wrapper so header and mobile section nav stick as a single
            unit (no relative slide, no seam); dissolves on desktop */}
        <div className="header-stack">
          <header className="site-header">
            <div className="wrap">
              <Wordmark siteName={site.siteName} />
              <span className="tagline">{site.tagline}</span>
              <HeaderStatus />
              <div className="header-right">
                {/* two quiet links only; the header is full and everything else stays in the footer */}
                <nav className="header-links">
                  <Link href="/about">About</Link>
                  <Link href="/subscribe">Subscribe</Link>
                </nav>
                <SearchBox />
                <ThemeToggle />
              </div>
            </div>
          </header>
          <MainNav sections={sections.map((s) => ({ id: s.id, title: s.title }))} />
        </div>
        {children}
        <footer className="site-footer">
          <div className="wrap">
            {/* the site's places, with the bot accounts tucked to the right */}
            <div className="footer-row">
              {/* the snapshot archive is reached by clicking the header's date */}
              <Link href="/stream">Stream</Link>
              <Link href="/day">Daily Archive</Link>
              <Link href="/subscribe">Email</Link>
              <Link href="/submit">Submit</Link>
              <Link href="/about">About</Link>
              <Link href="/criteria">Criteria</Link>
              <Link href="/sources">Sources</Link>
              {sponsorOn ? <Link href="/sponsor">Sponsor</Link> : null}
              {xHandle || fcHandle ? (
                <span className="footer-social">
                  {xHandle ? (
                    <a href={`https://x.com/${xHandle}`} rel="noopener" title={`${site.siteName} on X`} aria-label={`${site.siteName} on X`}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
                      </svg>
                    </a>
                  ) : null}
                  {fcHandle ? (
                    <a
                      href={`https://farcaster.xyz/${fcHandle}`}
                      rel="noopener"
                      title={`${site.siteName} on Farcaster`}
                      aria-label={`${site.siteName} on Farcaster`}
                    >
                      <svg viewBox="0 0 1000 1000" aria-hidden="true">
                        <path d="M257.778 155.556h484.444v688.888h-71.111V528.889h-.697c-7.86-87.212-81.156-155.556-170.414-155.556-89.258 0-162.554 68.344-170.414 155.556h-.697v315.555h-71.111V155.556Z" />
                        <path d="M128.889 253.333l28.889 97.778h24.444v395.556c-12.273 0-22.222 9.949-22.222 22.222v26.667h-4.444c-12.273 0-22.223 9.949-22.223 22.222v26.666h248.889v-26.666c0-12.273-9.95-22.222-22.222-22.222h-4.445v-26.667c0-12.273-9.949-22.222-22.222-22.222h-26.667V253.333H128.889Z" />
                        <path d="M675.556 746.667c-12.273 0-22.223 9.949-22.223 22.222v26.667h-4.444c-12.273 0-22.222 9.949-22.222 22.222v26.666h248.889v-26.666c0-12.273-9.95-22.222-22.223-22.222h-4.444v-26.667c0-12.273-9.95-22.222-22.222-22.222V351.111h24.444l28.889-97.778H653.333v493.334h22.223Z" />
                      </svg>
                    </a>
                  ) : null}
                </span>
              ) : null}
            </div>
            {/* quieter second row so the main row stops feeling crowded */}
            <div className="footer-row footer-meta">
              {/* the Admin link renders only in browsers that logged into the
                  admin (cosmetic cookie); visitors see nothing here */}
              <Link href="/privacy">Privacy</Link>
              <Link href="/contact">Contact</Link>
              <AdminLink />
              <LinkPrefToggle />
            </div>
          </div>
        </footer>
        {process.env.NEXT_PUBLIC_GA_ID ? <AnalyticsConsent gaId={process.env.NEXT_PUBLIC_GA_ID} /> : null}
      </body>
    </html>
  );
}
