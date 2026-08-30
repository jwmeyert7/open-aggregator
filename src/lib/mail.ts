import nodemailer from "nodemailer";
import { mailFrom, siteIdentity } from "./site";

/**
 * Generic SMTP sender. Defaults suit Gmail with an app password (the worked
 * example in the README): SMTP_HOST smtp.gmail.com, SMTP_PORT 465. Failures
 * are RETURNED, never swallowed: callers put them in the run log or their
 * response, because a silently missing email is a debugging dead end.
 */

function transport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/** null on success, otherwise the failure reason. */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<string | null> {
  const t = transport();
  if (!t) return "SMTP_USER / SMTP_PASS not configured";
  try {
    await t.sendMail({
      from: `"${siteIdentity().siteName}" <${mailFrom()}>`,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Best-effort admin notification to the SMTP account's own inbox. Missing
 * credentials or SMTP failures never break the caller: submissions still
 * queue in the admin regardless. The failure reason lands in the function
 * logs.
 */
export async function sendAdminEmail(subject: string, text: string): Promise<boolean> {
  const user = process.env.SMTP_USER;
  if (!user) return false;
  const err = await sendMail(user, subject, text);
  if (err) console.error(`[mail] admin email failed: ${err}`);
  return !err;
}

/**
 * Tell a submitter what happened to their link, when they left an email.
 * Best effort: the decision stands either way, and the returned string is a
 * short suffix for the admin's result toast (" Submitter emailed." or the
 * failure reason). The optional note is the editor's own words, sent as-is.
 */
export async function notifySubmitter(
  sub: { url: string; email?: string },
  outcome: "approved" | "dismissed",
  note?: string,
  storySlug?: string
): Promise<string> {
  if (!sub.email) return "";
  const site = siteIdentity();
  const lines =
    outcome === "approved"
      ? [
          `Good news. The link you suggested to ${site.siteName} was accepted and is on the site now.`,
          "",
          sub.url,
          ...(storySlug ? ["", `It joined this story: https://${site.domain}/story/${storySlug}`] : []),
        ]
      : [
          `Thanks for your suggestion to ${site.siteName}. An editor reviewed it and decided not to use it this time.`,
          "",
          sub.url,
        ];
  if (note) lines.push("", `A note from the editor: ${note}`);
  lines.push("", "Thanks for reading and for pitching in.", site.siteName);
  const subject =
    outcome === "approved" ? `Your ${site.siteName} suggestion made it on` : `About your ${site.siteName} suggestion`;
  const err = await sendMail(sub.email, subject, lines.join("\n"));
  if (err) console.error(`[mail] submitter email failed: ${err}`);
  return err ? ` (email to submitter failed: ${err})` : " Submitter emailed.";
}
