"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createInvite, revokeInvite } from "@/lib/api";
import { formatRelative, roleLabel } from "@/lib/format";
import { ASSIGNABLE_ROLES } from "@/lib/types";
import type { OrgInvite, OrgMember } from "@/lib/types";

interface TeamManagementCardProps {
  members: OrgMember[];
  invites: OrgInvite[];
}

/** Very permissive shape check — the server is the source of truth for validity. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function MemberRow({ member }: { member: OrgMember }) {
  const displayName = member.name ?? member.email;
  return (
    <li className="interactive-row flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-surface-muted/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {displayName}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted">{member.email}</p>
      </div>
      <Badge tone={member.role === "owner" ? "brand" : "neutral"}>
        {roleLabel(member.role)}
      </Badge>
    </li>
  );
}

interface InviteRowProps {
  invite: OrgInvite;
  onRevoked: (id: string) => void;
}

function InviteRow({ invite, onRevoked }: InviteRowProps) {
  const [revoking, setRevoking] = useState(false);
  const { notify } = useToast();

  async function handleRevoke() {
    if (revoking) return;
    setRevoking(true);
    try {
      await revokeInvite(invite.id);
      onRevoked(invite.id);
      notify("Invite revoked.", "success");
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't revoke the invite.",
        "error",
      );
      setRevoking(false);
    }
  }

  return (
    <li className="interactive-row flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-surface-muted/60">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {invite.email}
          </p>
          <Badge tone="neutral">{roleLabel(invite.role)}</Badge>
        </div>
        <p className="mt-0.5 truncate text-sm text-subtle">
          Invited {formatRelative(invite.invitedAt)}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Revoke invite for ${invite.email}`}
        onClick={() => void handleRevoke()}
        disabled={revoking}
      >
        {revoking ? "Revoking…" : "Revoke"}
      </Button>
    </li>
  );
}

/**
 * Team section: current members, an "invite member" form, and the list of
 * pending invitations. Owns invite/revoke mutations locally so Settings stays
 * a thin server-fetched shell.
 */
export function TeamManagementCard({ members, invites }: TeamManagementCardProps) {
  const [pendingInvites, setPendingInvites] = useState(invites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(ASSIGNABLE_ROLES[0]);
  const [sending, setSending] = useState(false);
  const { notify } = useToast();
  const emailFieldId = useId();
  const roleFieldId = useId();

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    const trimmedEmail = email.trim();
    if (!looksLikeEmail(trimmedEmail)) {
      notify("Enter a valid email address.", "error");
      return;
    }

    setSending(true);
    try {
      await createInvite(trimmedEmail, role);
      notify(`Invitation sent to ${trimmedEmail}.`, "success");
      setPendingInvites((prev) => [
        ...prev,
        {
          id: `optimistic_${Date.now()}`,
          email: trimmedEmail,
          role,
          status: "pending",
          invitedAt: new Date().toISOString(),
        },
      ]);
      setEmail("");
      setRole(ASSIGNABLE_ROLES[0]);
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't send the invite.",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  function handleRevoked(id: string) {
    setPendingInvites((prev) => prev.filter((invite) => invite.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team members</CardTitle>
        <Badge tone="neutral">{members.length}</Badge>
      </CardHeader>

      {members.length === 0 ? (
        <CardContent>
          <p className="py-4 text-center text-sm text-muted">
            Just you so far — invite members soon.
          </p>
        </CardContent>
      ) : (
        <ul className="stagger divide-y divide-border">
          {members.map((member) => (
            <MemberRow key={member.userId} member={member} />
          ))}
        </ul>
      )}

      <CardContent className="border-t border-border">
        <form
          onSubmit={(event) => void handleInvite(event)}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Input
            id={emailFieldId}
            label="Invite a member"
            type="email"
            placeholder="member@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={sending}
            className="sm:flex-1"
          />
          <div className="w-full sm:w-40">
            <label
              htmlFor={roleFieldId}
              className="block text-sm font-medium text-foreground"
            >
              Role
            </label>
            <select
              id={roleFieldId}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={sending}
              className="mt-1.5 block w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-brand-900"
            >
              {ASSIGNABLE_ROLES.map((assignableRole) => (
                <option key={assignableRole} value={assignableRole}>
                  {roleLabel(assignableRole)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={sending} className="shrink-0">
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </form>
      </CardContent>

      <CardContent className="border-t border-border">
        <h3 className="text-sm font-medium text-foreground">
          Pending invitations
        </h3>
        {pendingInvites.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No pending invitations.</p>
        ) : (
          <ul className="stagger mt-2 divide-y divide-border">
            {pendingInvites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} onRevoked={handleRevoked} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
