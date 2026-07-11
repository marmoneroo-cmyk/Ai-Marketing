import type { SVGProps } from "react";

/**
 * Minimal inline icon set (stroke-based, 24x24) so the app carries no external
 * icon dependency and nothing hits a CDN.
 */
type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    // Every icon here is decorative — the control it sits in always carries
    // its own text or aria-label, so hide the SVG from assistive tech (mirrors
    // the ad-hoc inline SVGs elsewhere: toast.tsx, verify-email-banner.tsx, etc).
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

export function IconDashboard(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconContent(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v16" />
    </svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

export function IconInbox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13" />
      <path d="M4 13h4l1.5 2.5h5L16 13h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function IconLeads(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16.5 8.5a3 3 0 0 1 0 5M18 19a5 5 0 0 0-3-4.6" />
    </svg>
  );
}

export function IconAnalytics(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 12a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1l-.4-2.5H9.1l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.3-.9-2 3.4L4.7 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 1.7 1l.4 2.5h4.1l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1z" />
    </svg>
  );
}

export function IconReach(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function IconAppointments(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4" />
    </svg>
  );
}

export function IconRevenue(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18M8 7.5a3.5 2.5 0 0 1 8 0c0 2.5-8 1.5-8 4.5a3.5 2.5 0 0 0 8 0" />
    </svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5M4 12h11" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function IconRocket(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.8-.8.9-2 .2-2.8l-.4-.4c-.8-.7-2-.6-2.8.2z" />
      <path d="M9 12a13 13 0 0 1 9-9c1.5 0 3 1.5 3 3a13 13 0 0 1-9 9z" />
      <path d="M15 9h.01" />
    </svg>
  );
}
