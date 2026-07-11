/** Small presentation helpers shared across dashboard pages. */

export function formatCompactNumber(value: number): string {
  // Guard non-finite input so a stray NaN/Infinity never renders as "NaN".
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatCurrency(value: number): string {
  // Guard non-finite input so a stray NaN never renders as "$NaN".
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Full day label, e.g. "Wed, Jul 9". Used to group items by calendar day. */
export function formatDayLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Stable YYYY-MM-DD key for grouping ISO timestamps by day. */
export function dayKey(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/** Title-case a role string, e.g. "owner" -> "Owner". */
export function roleLabel(role: string): string {
  if (role.length === 0) return role;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Compact relative label (e.g. "3h ago", "just now"); falls back to time. */
export function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDayLabel(iso);
  } catch {
    return "";
  }
}
