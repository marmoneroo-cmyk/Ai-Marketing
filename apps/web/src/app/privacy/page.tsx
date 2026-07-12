import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How BrandPilot collects, uses, stores, and protects your data.",
};

const UPDATED = "July 13, 2026";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains how <strong>BrandPilot</strong> (&quot;BrandPilot&quot;,
        &quot;we&quot;, &quot;us&quot;) collects, uses, stores, shares, and protects information when
        you use our autonomous AI marketing platform (the &quot;Service&quot;). By using the Service you
        agree to this Policy. If you do not agree, please do not use the Service.
      </p>

      <h2>1. Who we are</h2>
      <p>
        BrandPilot is a marketing automation service that helps a business plan and draft social
        content, understand its audience, and manage customer conversations. For any privacy question
        or request, contact us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>2. Information we collect</h2>
      <h3>a. Account information</h3>
      <p>
        Your name, email address, and organization details you provide when you sign up, plus
        authentication data needed to keep your account secure.
      </p>
      <h3>b. Business information</h3>
      <p>
        The website URL you provide and content we retrieve from it to build your business profile
        (your &quot;Business DNA&quot;), and any brand, product, or knowledge details you add.
      </p>
      <h3>c. Connected social accounts (Platform Data)</h3>
      <p>
        When you connect Instagram, Facebook, or TikTok, you authorize us — through the provider&apos;s
        official OAuth consent screen — to access, on your behalf:
      </p>
      <ul>
        <li>Basic account info (username, account id, profile details, follower/media counts).</li>
        <li>Media you have published (posts, images, captions) so we can analyze and schedule content.</li>
        <li>Comments on your own media, so the Service can surface them and help you reply.</li>
        <li>An access token, which we store <strong>encrypted</strong> and use only to call the provider&apos;s API on your behalf.</li>
      </ul>
      <p>
        We only request the permissions needed for features you use, and we access this data solely to
        provide the Service to you. We never sell it.
      </p>
      <h3>d. Usage &amp; technical data</h3>
      <p>
        Standard logs (e.g. actions taken, timestamps, error diagnostics) used to operate, secure, and
        improve the Service.
      </p>

      <h2>3. How we use your information</h2>
      <ul>
        <li>Build your Business DNA and generate on-brand content drafts for your review.</li>
        <li>Surface comments/messages and draft grounded replies you can approve before sending.</li>
        <li>Show analytics such as reach, engagement, and follower counts.</li>
        <li>Operate, secure, debug, and improve the Service.</li>
      </ul>
      <p>
        Customer-facing content and replies are generated for your review; you remain in control of
        what is published or sent.
      </p>

      <h2>4. AI processing</h2>
      <p>
        To generate content and replies, we send the relevant context (e.g. your business profile and
        the specific text being processed) to third-party AI providers. We do not use your data to
        train our own models, and we instruct our providers not to use it to train theirs where such
        controls are offered.
      </p>

      <h2>5. Service providers we share data with</h2>
      <p>
        We share the minimum data necessary with vetted processors who act on our behalf, including:
      </p>
      <ul>
        <li><strong>AI model providers</strong> (Anthropic, Google) — to generate content and replies.</li>
        <li><strong>Voyage AI</strong> — to create text embeddings that power grounded, on-brand output.</li>
        <li><strong>Firecrawl</strong> — to retrieve public content from the website URL you provide.</li>
        <li><strong>FAL</strong> — to generate images when you request them.</li>
        <li><strong>Stripe</strong> — to process payments (we never store full card numbers).</li>
        <li><strong>Supabase / Amazon Web Services</strong> — database and file storage.</li>
        <li><strong>Railway</strong> — application hosting.</li>
        <li><strong>Sentry</strong> — error monitoring.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information or your Platform Data, and we do not
        share it for third-party advertising.
      </p>

      <h2>6. Meta Platform Data</h2>
      <p>
        Data obtained from Meta (Instagram/Facebook) is &quot;Platform Data&quot; and is handled in
        accordance with the Meta Platform Terms and Developer Policies. We use it only to provide the
        features you enable, retain it only as long as needed for those features, and delete it on
        request or when you disconnect the account (see Data Deletion below). The same principles apply
        to data obtained from TikTok under its Developer Terms.
      </p>

      <h2>7. Data retention</h2>
      <p>
        We keep your information for as long as your account is active and as needed to provide the
        Service. When you disconnect a channel, we stop accessing that provider and delete its stored
        access token. When you delete your account, we delete or de-identify your data within 30 days,
        except where we must retain limited records to comply with law.
      </p>

      <h2>8. Security</h2>
      <p>
        We encrypt connector access tokens at rest (AES-256-GCM), enforce per-organization data
        isolation, transmit data over TLS, and restrict access to authorized systems. No method of
        transmission or storage is perfectly secure, but we work to protect your data using industry
        practices.
      </p>

      <h2>9. Your rights</h2>
      <p>
        You may access, correct, export, or delete your personal data, disconnect any channel at any
        time from Settings, and request account deletion. To exercise these rights, use the in-app
        controls or contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. See our{" "}
        <Link href="/data-deletion">Data Deletion</Link> page for how to remove your data.
      </p>

      <h2>10. Children&apos;s privacy</h2>
      <p>The Service is not directed to children under 16, and we do not knowingly collect their data.</p>

      <h2>11. Changes to this Policy</h2>
      <p>
        We may update this Policy from time to time. Material changes will be reflected by the
        &quot;Last updated&quot; date above and, where appropriate, communicated to you.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about this Policy? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <p className="!mt-8 text-xs !text-subtle">
        This document is a template provided for transparency and platform-review purposes and should
        be reviewed by your legal counsel and completed with your registered business name and address
        before commercial launch.
      </p>
    </LegalPage>
  );
}
