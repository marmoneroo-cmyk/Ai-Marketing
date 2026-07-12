import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "How to disconnect a channel and delete your data from BrandPilot.",
};

const UPDATED = "July 13, 2026";

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion" updated={UPDATED}>
      <p>
        You are in control of your data. This page explains how to disconnect a social account and how
        to request deletion of your data from <strong>BrandPilot</strong>, in line with the Meta
        Platform Terms, the TikTok Developer Terms, and applicable privacy law.
      </p>

      <h2>Option 1 — Disconnect a channel (immediate)</h2>
      <p>
        To revoke BrandPilot&apos;s access to a connected Instagram, Facebook, or TikTok account:
      </p>
      <ul>
        <li>Sign in to BrandPilot and go to <strong>Settings → Connected channels</strong>.</li>
        <li>Find the channel and disconnect it.</li>
        <li>
          We immediately stop calling that provider on your behalf and delete the stored access token
          for that account.
        </li>
      </ul>
      <p>
        You can also remove BrandPilot from the provider&apos;s side at any time — for example, in
        Instagram/Facebook under <strong>Settings → Apps and websites</strong>, or in TikTok under{" "}
        <strong>Manage app permissions</strong>.
      </p>

      <h2>Option 2 — Delete your account and all data</h2>
      <p>
        To delete your BrandPilot account and all associated data, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Data%20deletion%20request`}>{SUPPORT_EMAIL}</a> from
        the address on your account with the subject &quot;Data deletion request&quot;, or use the
        account-deletion control in Settings where available.
      </p>

      <h2>What we delete</h2>
      <ul>
        <li>Your account and organization records.</li>
        <li>Connected-account data we retrieved (profile info, media metadata, comments) and the encrypted access tokens.</li>
        <li>Your Business DNA, generated content, drafts, conversations, and analytics derived from your data.</li>
      </ul>
      <p>
        We complete deletion within <strong>30 days</strong> of a verified request and confirm by email.
        We may retain a limited, minimal set of records where required to comply with law (e.g. billing
        records), after which they are also deleted.
      </p>

      <h2>Meta / Instagram data</h2>
      <p>
        Data obtained from Meta is deleted as described above when you disconnect the channel or delete
        your account. If you have any difficulty removing your data, contact us and we will assist
        promptly.
      </p>

      <h2>Contact</h2>
      <p>
        For any data-deletion request or question, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Data%20deletion%20request`}>{SUPPORT_EMAIL}</a>. See
        also our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
