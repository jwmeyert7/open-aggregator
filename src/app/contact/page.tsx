import { siteIdentity } from "@/lib/site";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  const email = siteIdentity().contactEmail;
  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Contact</h1>
        <p>
          Questions, corrections, story tips, source suggestions, or sponsorship inquiries all go to the same place:{" "}
          <a href={`mailto:${email}`}>{email}</a>
        </p>
      </div>
    </main>
  );
}
