import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of BrandPilot.",
};

const UPDATED = "July 13, 2026";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={UPDATED}>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of{" "}
        <strong>BrandPilot</strong> (the &quot;Service&quot;). By creating an account or using the
        Service, you agree to these Terms. If you use the Service on behalf of an organization, you
        represent that you are authorized to bind that organization.
      </p>

      <h2>1. The Service</h2>
      <p>
        BrandPilot helps you plan and draft social media content, understand your audience, and manage
        customer conversations across connected channels. Features that rely on third-party platforms
        (e.g. Instagram, Facebook, TikTok) depend on those platforms&apos; APIs and are subject to their
        terms and availability.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You are responsible for the accuracy of your account information and for keeping your credentials secure.</li>
        <li>You are responsible for all activity that occurs under your account.</li>
        <li>You must be at least 16 years old and legally able to enter into these Terms.</li>
      </ul>

      <h2>3. Connected accounts</h2>
      <p>
        When you connect a social account, you authorize BrandPilot to access and act on your behalf
        within the scope you approve on the provider&apos;s consent screen. You may disconnect any
        channel at any time from Settings. You are responsible for complying with each connected
        platform&apos;s terms and policies.
      </p>

      <h2>4. Your content</h2>
      <p>
        You retain ownership of the content, business information, and materials you provide or that we
        retrieve on your behalf (&quot;Your Content&quot;). You grant BrandPilot a limited license to
        process Your Content solely to provide the Service to you. You are responsible for reviewing and
        approving AI-generated drafts before they are published or sent.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Violate any law or any third-party platform&apos;s terms or policies.</li>
        <li>Send spam, deceptive, infringing, hateful, or otherwise harmful content.</li>
        <li>Attempt to reverse engineer, disrupt, or gain unauthorized access to the Service.</li>
        <li>Misuse another person&apos;s data or infringe their rights.</li>
      </ul>

      <h2>6. AI-generated output</h2>
      <p>
        The Service produces AI-generated suggestions and drafts. These may contain inaccuracies. You
        are solely responsible for reviewing output and for anything you choose to publish or send. The
        Service is a tool to assist you, not a substitute for your own judgment.
      </p>

      <h2>7. Fees</h2>
      <p>
        Paid plans, if any, are billed as described at purchase. Fees are non-refundable except where
        required by law. We may change pricing prospectively with notice.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We may suspend or terminate
        access for violation of these Terms or to protect the Service or its users. On termination, the
        data-handling described in our{" "}
        <Link href="/privacy">Privacy Policy</Link> and{" "}
        <Link href="/data-deletion">Data Deletion</Link> page applies.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any
        kind, to the maximum extent permitted by law. We do not warrant that the Service will be
        uninterrupted, error-free, or that AI output will be accurate or fit for a particular purpose.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, BrandPilot will not be liable for any indirect,
        incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data,
        or goodwill, arising from your use of the Service.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes will be reflected by the
        &quot;Last updated&quot; date above. Continued use after changes constitutes acceptance.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <p className="!mt-8 text-xs !text-subtle">
        This document is a template provided for platform-review purposes and should be reviewed by your
        legal counsel and completed with your registered business name, governing law, and jurisdiction
        before commercial launch.
      </p>
    </LegalPage>
  );
}
