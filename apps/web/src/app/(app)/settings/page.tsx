import type { Metadata } from "next";
import { getChannels, getInvites, getMembers, getOrgProfile } from "@/lib/api";
import type { OrgInvite, OrgMember } from "@/lib/types";
import { SettingsClient, type ConnectResult } from "./SettingsClient";

export const metadata: Metadata = { title: "Settings" };

/** Read the one-shot `?connected` / `?connect_error` param the OAuth callback sets. */
function parseConnectResult(sp: Record<string, string | string[] | undefined>): ConnectResult | null {
  const connected = typeof sp.connected === "string" ? sp.connected : undefined;
  const failed = typeof sp.connect_error === "string" ? sp.connect_error : undefined;
  if (connected) return { status: "success", provider: connected };
  if (failed) return { status: "error", provider: failed };
  return null;
}

/**
 * A non-privileged caller or a transient failure must not crash the Settings
 * page — the team card just renders empty in that case.
 */
async function getMembersSafe(): Promise<OrgMember[]> {
  try {
    return await getMembers();
  } catch {
    return [];
  }
}

/**
 * A non-privileged caller or a transient failure must not crash the Settings
 * page — the pending-invitations list just renders empty in that case.
 */
async function getInvitesSafe(): Promise<OrgInvite[]> {
  try {
    return await getInvites();
  } catch {
    return [];
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [channels, org, members, invites, sp] = await Promise.all([
    getChannels(),
    getOrgProfile(),
    getMembersSafe(),
    getInvitesSafe(),
    searchParams,
  ]);
  const connectResult = parseConnectResult(sp);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Connected channels, autonomy caps, and your organization profile.
        </p>
      </div>

      <SettingsClient
        channels={channels}
        org={org}
        members={members}
        invites={invites}
        connectResult={connectResult}
      />
    </div>
  );
}
