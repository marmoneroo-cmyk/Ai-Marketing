import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamManagementCard } from "./TeamManagementCard";
import { ToastProvider } from "@/components/ui/toast";
import { createInvite, revokeInvite } from "@/lib/api";
import type { OrgInvite, OrgMember } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

const MEMBERS: OrgMember[] = [
  {
    userId: "usr_01",
    email: "ava@luminaskin.co",
    name: "Ava Chen",
    role: "owner",
  },
  {
    userId: "usr_02",
    email: "devon@luminaskin.co",
    name: "Devon Ruiz",
    role: "admin",
  },
  {
    userId: "usr_03",
    email: "priya@luminaskin.co",
    name: null,
    role: "member",
  },
];

const INVITES: OrgInvite[] = [
  {
    id: "inv_01",
    email: "jordan@luminaskin.co",
    role: "marketer",
    status: "pending",
    invitedAt: "2026-07-09T15:30:00Z",
  },
];

function renderCard(members: OrgMember[] = MEMBERS, invites: OrgInvite[] = INVITES) {
  return render(
    <ToastProvider>
      <TeamManagementCard members={members} invites={invites} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(createInvite).mockReset();
  vi.mocked(createInvite).mockResolvedValue(undefined);
  vi.mocked(revokeInvite).mockReset();
  vi.mocked(revokeInvite).mockResolvedValue(undefined);
});

describe("TeamManagementCard", () => {
  // ── Member rendering (ported from the former TeamMembersCard tests) ──────

  it("renders each member's name (or email fallback) with a role badge", () => {
    renderCard();
    // Scope to the members <ul> — the role <select>'s <option> text (e.g.
    // "Admin"/"Marketer") would otherwise collide with badge text.
    const memberList = within(screen.getByText("Ava Chen").closest("ul")!);

    expect(memberList.getByText("Ava Chen")).toBeInTheDocument();
    expect(memberList.getByText("ava@luminaskin.co")).toBeInTheDocument();
    expect(memberList.getByText("Owner")).toBeInTheDocument();

    expect(memberList.getByText("Devon Ruiz")).toBeInTheDocument();
    expect(memberList.getByText("devon@luminaskin.co")).toBeInTheDocument();
    expect(memberList.getByText("Admin")).toBeInTheDocument();

    // No name: falls back to email as the display name, and the email is
    // still shown as the muted line, so it appears twice.
    expect(memberList.getAllByText("priya@luminaskin.co")).toHaveLength(2);
    expect(memberList.getByText("Member")).toBeInTheDocument();
  });

  it("shows the member count badge in the header", () => {
    renderCard();

    expect(screen.getByText("Team members")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("gives the owner a distinct badge tone from other roles", () => {
    renderCard();
    const memberList = within(screen.getByText("Ava Chen").closest("ul")!);

    const ownerBadge = memberList.getByText("Owner");
    const adminBadge = memberList.getByText("Admin");
    const memberBadge = memberList.getByText("Member");

    // tone="brand" vs tone="neutral" map to different background classes.
    expect(ownerBadge.className).not.toEqual(adminBadge.className);
    expect(adminBadge.className).toEqual(memberBadge.className);
  });

  it("shows the members empty state when there are no members", () => {
    renderCard([]);

    expect(
      screen.getByText("Just you so far — invite members soon."),
    ).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // ── Invite form ────────────────────────────────────────────────────────

  it("submits the invite form with the chosen email and role, and shows a success toast", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(
      screen.getByLabelText("Invite a member"),
      "newperson@luminaskin.co",
    );
    await user.selectOptions(screen.getByLabelText("Role"), "sales");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(createInvite).toHaveBeenCalledTimes(1);
    expect(createInvite).toHaveBeenCalledWith("newperson@luminaskin.co", "sales");
    expect(
      await screen.findByText("Invitation sent to newperson@luminaskin.co."),
    ).toBeInTheDocument();
  });

  it("clears the form and adds an optimistic pending row after a successful invite", async () => {
    const user = userEvent.setup();
    renderCard();

    const emailField = screen.getByLabelText("Invite a member");
    await user.type(emailField, "newperson@luminaskin.co");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await screen.findByText("Invitation sent to newperson@luminaskin.co.");

    expect(emailField).toHaveValue("");
    expect(screen.getByText("newperson@luminaskin.co")).toBeInTheDocument();
  });

  it("disables and relabels the submit button while the invite is pending", async () => {
    let resolveInvite: () => void = () => {};
    vi.mocked(createInvite).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvite = () => resolve(undefined);
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await user.type(
      screen.getByLabelText("Invite a member"),
      "newperson@luminaskin.co",
    );
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    const pendingButton = screen.getByRole("button", { name: "Sending…" });
    expect(pendingButton).toBeDisabled();

    resolveInvite();
  });

  it("rejects an empty/invalid email client-side without calling createInvite", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(createInvite).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Enter a valid email address."),
    ).toBeInTheDocument();
  });

  it("surfaces the server error message and keeps the form populated when createInvite rejects", async () => {
    vi.mocked(createInvite).mockRejectedValueOnce(
      new Error("This email is already a member."),
    );
    const user = userEvent.setup();
    renderCard();

    const emailField = screen.getByLabelText("Invite a member");
    await user.type(emailField, "ava@luminaskin.co");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(
      await screen.findByText("This email is already a member."),
    ).toBeInTheDocument();
    // Form stays populated so the user can retry / correct.
    expect(emailField).toHaveValue("ava@luminaskin.co");
  });

  // ── Pending invitations ───────────────────────────────────────────────

  it("lists pending invites with email, role badge, and a relative invited time", () => {
    renderCard();
    // Scope to the invite row — the role <select>'s "Marketer" <option> text
    // would otherwise collide with the badge text.
    const inviteRow = within(
      screen.getByText("jordan@luminaskin.co").closest("li")!,
    );

    expect(inviteRow.getByText("jordan@luminaskin.co")).toBeInTheDocument();
    expect(inviteRow.getByText("Marketer")).toBeInTheDocument();
    expect(inviteRow.getByText(/^Invited /)).toBeInTheDocument();
  });

  it("shows the empty state when there are no pending invitations", () => {
    renderCard(MEMBERS, []);

    expect(screen.getByText("No pending invitations.")).toBeInTheDocument();
  });

  it("clicking Revoke calls revokeInvite and removes the row on success", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Revoke invite for jordan@luminaskin.co" }));

    expect(revokeInvite).toHaveBeenCalledWith("inv_01");
    expect(await screen.findByText("Invite revoked.")).toBeInTheDocument();
    expect(screen.queryByText("jordan@luminaskin.co")).not.toBeInTheDocument();
    expect(screen.getByText("No pending invitations.")).toBeInTheDocument();
  });

  it("shows an error toast and keeps the row when revokeInvite rejects", async () => {
    vi.mocked(revokeInvite).mockRejectedValueOnce(new Error("Something broke"));
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Revoke invite for jordan@luminaskin.co" }));

    expect(await screen.findByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText("jordan@luminaskin.co")).toBeInTheDocument();
  });
});
