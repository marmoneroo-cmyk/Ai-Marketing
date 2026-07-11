import type { Metadata } from "next";
import { ApprovalsPanel } from "@/components/ApprovalsPanel";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCheck } from "@/components/icons";
import { getApprovals } from "@/lib/api";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const approvals = await getApprovals();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Approvals
        </h1>
        <p className="mt-1 text-sm text-muted">
          Everything waiting on your sign-off.
        </p>
      </div>

      {approvals.length === 0 ? (
        <EmptyState
          icon={<IconCheck className="h-6 w-6" />}
          title="You're all caught up"
          description="Nothing needs your approval right now. BrandPilot will surface items here as they come up."
        />
      ) : (
        <ApprovalsPanel approvals={approvals} />
      )}
    </div>
  );
}
