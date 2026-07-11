import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { getChannels, getOrgProfile } from "@/lib/api";
import { OnboardingClient } from "./OnboardingClient";

export default async function OnboardingPage() {
  // Fetched in parallel — independent reads, and getChannels() already has its
  // own demo-mode fallback (see lib/api.ts's withFallback), so no extra
  // try/catch wrapper is needed here (mirrors settings/page.tsx, which also
  // calls getChannels() directly, unlike the permission-gated getMembers/getInvites).
  const [org, channels] = await Promise.all([getOrgProfile(), getChannels()]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {!org.emailVerified ? <VerifyEmailBanner /> : null}
      <OnboardingClient channels={channels} />
    </div>
  );
}
