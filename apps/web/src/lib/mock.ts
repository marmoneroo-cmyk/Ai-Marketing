/**
 * Realistic placeholder data. The api client falls back to these when the
 * NestJS API is unreachable, so the dashboard always renders in a demo/dev
 * environment without a running backend.
 */
import type {
  AnalyticsSnapshot,
  CalendarEntry,
  ConnectedChannel,
  ContentItem,
  ConversationMessage,
  ConversationSummary,
  DashboardSnapshot,
  InvitePreview,
  Lead,
  LeadSummary,
  LoginResult,
  OrgInvite,
  OrgMember,
  OrgProfile,
  Paginated,
  PendingApproval,
} from "./types";

/**
 * Wrap a full mock array as a single `Paginated` page. Demo fallbacks return the
 * complete dataset on page 1 (there is never a second page of mock data), so the
 * page/limit reflect the caller's request and `total` is the array length.
 */
function mockPage<T>(items: readonly T[], page: number, limit: number): Paginated<T> {
  return { items: [...items], total: items.length, page, limit };
}

export const mockDashboard: DashboardSnapshot = {
  autonomy: "suggest",
  kpis: {
    reach: 128400,
    reachDelta: 12.4,
    leads: 342,
    leadsDelta: 8.1,
    appointments: 47,
    appointmentsDelta: -3.2,
    revenue: 38650,
    revenueDelta: 21.7,
  },
  scores: {
    marketing: 82,
    sales: 74,
    growth: 68,
  },
  approvals: [
    {
      id: "apr_01",
      kind: "content",
      title: "Reel: “3 signs your skincare routine is aging you”",
      summary:
        "AI-drafted 22s reel with hook, captions, and trending audio. On-brand voice check passed (0.94).",
      platform: "instagram",
      confidence: 94,
      createdAt: "2026-07-08T08:12:00Z",
    },
    {
      id: "apr_02",
      kind: "publish",
      title: "Publish carousel to Facebook + Instagram",
      summary:
        "Optimal window detected: today 6:30pm. Cross-post to 2 channels with tailored captions.",
      platform: "facebook",
      confidence: 88,
      createdAt: "2026-07-08T07:40:00Z",
    },
    {
      id: "apr_03",
      kind: "quote",
      title: "Quote for Marlow & Co. — brand refresh package",
      summary:
        "Sales AI assembled a $2,400 package from your service catalog. Awaiting your approval to send.",
      value: 2400,
      confidence: 79,
      createdAt: "2026-07-08T06:55:00Z",
    },
    {
      id: "apr_04",
      kind: "content",
      title: "Email: July promo — “Mid-summer glow, 20% off”",
      summary:
        "Segment: warm leads (312). Subject-line A/B variants generated. Voice + policy checks passed.",
      platform: "email",
      confidence: 91,
      createdAt: "2026-07-08T06:20:00Z",
    },
  ],
  recommendations: [
    {
      id: "rec_01",
      title: "Shift Reels to 6–8pm on weekdays",
      detail:
        "Reels posted in this window earned 2.3× the saves over the last 21 days. Auto-scheduling will apply on approval.",
      confidence: 86,
      impact: "high",
      module: "Optimization",
    },
    {
      id: "rec_02",
      title: "Add a “book a call” CTA to top 3 posts",
      detail:
        "Your highest-reach posts have no direct CTA. Adding one could recover an est. 18–24 leads/mo.",
      confidence: 72,
      impact: "medium",
      module: "Sales",
    },
    {
      id: "rec_03",
      title: "Answer the 5 most-asked DMs with a saved reply",
      detail:
        "Conversation AI can auto-handle these FAQ intents at 0.9+ confidence, freeing ~40 min/week.",
      confidence: 90,
      impact: "medium",
      module: "Conversation",
    },
  ],
  completedTasks: [
    {
      id: "tsk_01",
      label: "Published 2 posts (IG, TikTok)",
      module: "Publishing",
      at: "2026-07-08T09:05:00Z",
    },
    {
      id: "tsk_02",
      label: "Replied to 11 comments, 4 DMs",
      module: "Conversation",
      at: "2026-07-08T08:41:00Z",
    },
    {
      id: "tsk_03",
      label: "Qualified 3 new leads",
      module: "Sales",
      at: "2026-07-08T08:10:00Z",
    },
    {
      id: "tsk_04",
      label: "Refreshed audience segments",
      module: "Audience Intelligence",
      at: "2026-07-08T07:30:00Z",
    },
    {
      id: "tsk_05",
      label: "Rolled up yesterday’s KPIs",
      module: "Analytics",
      at: "2026-07-08T06:00:00Z",
    },
  ],
};

/**
 * Full pending-approvals queue behind `GET /approvals` (up to the API's
 * `RECENT_LIMIT`), spanning every kind the web renders — deliberately broader
 * than the 4-item snapshot in `mockDashboard.approvals` above, so the
 * `/approvals` page visibly shows more than the dashboard preview and
 * exercises the quote `$` badge across multiple entries.
 */
export const mockAllApprovals: PendingApproval[] = [
  {
    id: "apr_101",
    kind: "quote",
    title: "Quote for Harlow Aesthetics — laser + facials bundle",
    summary:
      "Sales AI assembled a $3,200 package from your service catalog. Awaiting your approval to send.",
    value: 3200,
    confidence: 82,
    createdAt: "2026-07-11T09:10:00Z",
  },
  {
    id: "apr_102",
    kind: "content",
    title: "Reel: “5-minute morning routine for glass skin”",
    summary:
      "AI-drafted 18s reel with hook, captions, and trending audio. On-brand voice check passed (0.92).",
    platform: "instagram",
    confidence: 92,
    createdAt: "2026-07-11T08:45:00Z",
  },
  {
    id: "apr_103",
    kind: "publish",
    title: "Publish carousel to Facebook + Instagram",
    summary:
      "Optimal window detected: today 5:00pm. Cross-post to 2 channels with tailored captions.",
    platform: "facebook",
    confidence: 87,
    createdAt: "2026-07-11T08:20:00Z",
  },
  {
    id: "apr_104",
    kind: "quote",
    title: "Quote for Priya Nair — quarterly skincare membership",
    summary:
      "Sales AI assembled a $980 membership renewal from your service catalog. Awaiting your approval to send.",
    value: 980,
    confidence: 75,
    createdAt: "2026-07-11T07:55:00Z",
  },
  {
    id: "apr_105",
    kind: "content",
    title: "TikTok: “Dermatologist reacts to viral skincare hacks”",
    summary:
      "Fast-cut reaction script with on-screen captions. On-brand voice check passed (0.88).",
    platform: "tiktok",
    confidence: 88,
    createdAt: "2026-07-11T07:30:00Z",
  },
  {
    id: "apr_106",
    kind: "content",
    title: "Email: August loyalty rewards — “You’ve earned it”",
    summary:
      "Segment: repeat clients (204). Subject-line A/B variants generated. Voice + policy checks passed.",
    platform: "email",
    confidence: 90,
    createdAt: "2026-07-10T18:10:00Z",
  },
  {
    id: "apr_107",
    kind: "publish",
    title: "Publish GBP post: new weekend hours",
    summary:
      "Optimal window detected: tomorrow 9:00am. Local visibility update with booking link.",
    platform: "google",
    confidence: 84,
    createdAt: "2026-07-10T16:40:00Z",
  },
  {
    id: "apr_108",
    kind: "quote",
    title: "Quote for Marlow & Co. — brand refresh add-on",
    summary:
      "Sales AI assembled a $1,450 add-on package from your service catalog. Awaiting your approval to send.",
    value: 1450,
    confidence: 70,
    createdAt: "2026-07-10T15:05:00Z",
  },
];

/**
 * A branded gradient SVG as a `data:` URI — stands in for a creative-studio
 * render in the demo build (which has no object storage), so the content screen
 * shows a real generated visual per format. Production swaps these for served
 * asset URLs once the storage → serve-URL pipeline lands.
 */
function generatedVisual(opts: {
  label: string;
  from: string;
  to: string;
  aspect: "portrait" | "square";
}): string {
  const [w, h] = opts.aspect === "portrait" ? [320, 400] : [360, 360];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${opts.from}"/><stop offset="1" stop-color="${opts.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<circle cx="${Math.round(w * 0.74)}" cy="${Math.round(h * 0.26)}" r="${Math.round(w * 0.17)}" fill="rgba(255,255,255,0.18)"/>` +
    `<circle cx="${Math.round(w * 0.24)}" cy="${Math.round(h * 0.66)}" r="${Math.round(w * 0.1)}" fill="rgba(255,255,255,0.12)"/>` +
    `<text x="22" y="${h - 28}" font-family="system-ui,-apple-system,sans-serif" font-size="19" font-weight="600" fill="rgba(255,255,255,0.95)">${opts.label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const mockContent: ContentItem[] = [
  {
    id: "c_01",
    title: "Reel: 3 signs your skincare routine is aging you",
    platform: "instagram",
    format: "reel",
    status: "needs_approval",
    scheduledFor: "2026-07-08T18:30:00Z",
    caption: "Hook-first reel with trending audio and a soft CTA to book.",
    media: {
      url: generatedVisual({ label: "Reel · IG", from: "#a78bfa", to: "#ec4899", aspect: "portrait" }),
      kind: "video",
      alt: "AI-generated reel cover: 3 signs your skincare routine is aging you",
      aspect: "portrait",
    },
    approvalId: "capr_01",
    variants: [
      {
        id: "cv_01a",
        platform: "instagram",
        caption:
          "3 signs your skincare routine is quietly aging you (and the 2-minute fix). Save this before your next wash.",
        hook: "3 signs your skincare routine is aging you",
        cta: "Book a free skin check →",
        hashtags: ["skincaretips", "antiaging", "glowup"],
        voiceScore: 94,
        status: "needs_approval",
      },
      {
        id: "cv_01b",
        platform: "tiktok",
        caption:
          "POV: your 'anti-aging' routine is the problem. Here are 3 signs — and what to do instead.",
        hook: "Your anti-aging routine might be the problem",
        cta: "Comment ROUTINE for my list",
        hashtags: ["skintok", "spf", "dermtips"],
        voiceScore: 71,
        status: "needs_approval",
      },
    ],
  },
  {
    id: "c_02",
    title: "Carousel: Before / after — the 4-week glow plan",
    platform: "facebook",
    format: "carousel",
    status: "scheduled",
    scheduledFor: "2026-07-09T17:00:00Z",
    caption: "Educational carousel, 6 slides, brand-kit styled.",
    media: {
      url: generatedVisual({ label: "Carousel", from: "#38bdf8", to: "#6366f1", aspect: "square" }),
      kind: "image",
      alt: "AI-generated carousel cover: the 4-week glow plan",
      aspect: "square",
    },
    approvalId: "capr_02",
    variants: [
      {
        id: "cv_02a",
        platform: "facebook",
        caption:
          "The 4-week glow plan our clients keep asking for — swipe for the week-by-week breakdown.",
        hook: "Before / after: the 4-week glow plan",
        cta: "Start your plan today",
        hashtags: ["skincareroutine", "glowplan"],
        voiceScore: 88,
        status: "scheduled",
      },
      {
        id: "cv_02b",
        platform: "instagram",
        caption:
          "4 weeks. 6 simple steps. Real results. Swipe to see the glow plan →",
        hook: "4 weeks to your best skin",
        cta: "Save + share with a friend",
        hashtags: ["glowup", "beforeafter", "skingoals"],
        voiceScore: 62,
        status: "scheduled",
      },
    ],
  },
  {
    id: "c_03",
    title: "TikTok: “What I wish I knew about SPF”",
    platform: "tiktok",
    format: "reel",
    status: "scheduled",
    scheduledFor: "2026-07-09T20:00:00Z",
    caption: "Fast-cut talking-head script, on-screen captions.",
    media: {
      url: generatedVisual({ label: "Reel · TikTok", from: "#f472b6", to: "#f59e0b", aspect: "portrait" }),
      kind: "video",
      alt: "AI-generated reel cover: what I wish I knew about SPF",
      aspect: "portrait",
    },
    approvalId: "capr_03",
    variants: [
      {
        id: "cv_03a",
        platform: "tiktok",
        caption:
          "What I wish I knew about SPF before my 30s. #3 shocked my clients.",
        hook: "What I wish I knew about SPF",
        cta: "Follow for daily skin science",
        hashtags: ["spf", "sunscreen", "skintok"],
        voiceScore: 79,
        status: "scheduled",
      },
    ],
  },
  {
    id: "c_04",
    title: "Email: Mid-summer glow — 20% off",
    platform: "email",
    format: "post",
    status: "draft",
    scheduledFor: "2026-07-10T14:00:00Z",
    caption: "Warm-lead promo with A/B subject lines.",
    approvalId: "capr_04",
    variants: [
      {
        id: "cv_04a",
        platform: "email",
        caption:
          "Your mid-summer glow is 20% off this week only. Here's the routine we'd build for you.",
        hook: "Mid-summer glow, 20% off",
        cta: "Claim your 20% off",
        hashtags: [],
        voiceScore: 91,
        status: "draft",
      },
    ],
  },
  {
    id: "c_05",
    title: "YouTube Short: 15s product teaser",
    platform: "youtube",
    format: "story",
    status: "draft",
    scheduledFor: "2026-07-11T16:00:00Z",
    caption: "Repurposed from the top-performing reel.",
    approvalId: null,
    variants: [],
  },
  {
    id: "c_06",
    title: "GBP post: July hours + booking link",
    platform: "google",
    format: "post",
    status: "published",
    scheduledFor: "2026-07-07T12:00:00Z",
    caption: "Local visibility update with CTA.",
    approvalId: "capr_06",
    variants: [
      {
        id: "cv_06a",
        platform: "google",
        caption:
          "Updated July hours + easy online booking. Tap to reserve your glow session.",
        hook: "July hours + booking",
        cta: "Book now",
        hashtags: [],
        voiceScore: 85,
        status: "published",
      },
    ],
  },
];

export const mockLogin: LoginResult = {
  accessToken: "demo.mock.token",
};

export const mockConversations: ConversationSummary[] = [
  // First in the list -> the default active conversation (inbox/page.tsx falls
  // back to conversations[0] with no `?conversation=`). Kept `needs_human` so
  // the reply composer (ConversationThread/ReplyComposer) is visibly exercised
  // out of the box in the demo build.
  {
    id: "cnv_01",
    channel: "instagram",
    status: "needs_human",
    intent: "Booking question",
    lastMessageAt: "2026-07-08T09:12:00Z",
    contactHandle: "@mara.k",
  },
  {
    id: "cnv_02",
    channel: "dm",
    status: "ai_handling",
    intent: "Pricing",
    lastMessageAt: "2026-07-08T08:47:00Z",
    contactHandle: "@devon.rt",
  },
  {
    id: "cnv_03",
    channel: "facebook",
    status: "open",
    intent: "Product availability",
    lastMessageAt: "2026-07-08T08:05:00Z",
    contactHandle: "Priya Nair",
  },
  {
    id: "cnv_04",
    channel: "comment",
    status: "ai_handling",
    intent: "Compliment",
    lastMessageAt: "2026-07-08T07:22:00Z",
    contactHandle: "@glowgetter",
  },
  {
    id: "cnv_05",
    channel: "email",
    status: "closed",
    intent: "Refund resolved",
    lastMessageAt: "2026-07-07T18:40:00Z",
    contactHandle: "sam@wells.co",
  },
];

export const mockConversationMessages: ConversationMessage[] = [
  {
    id: "msg_01",
    direction: "inbound",
    author: "customer",
    body: "Hi! Do you have any openings for a facial this Saturday?",
    createdAt: "2026-07-08T09:02:00Z",
  },
  {
    id: "msg_02",
    direction: "outbound",
    author: "agent",
    body: "We do! Saturday has 11:00am and 2:30pm free. Want me to hold one for you?",
    createdAt: "2026-07-08T09:04:00Z",
  },
  {
    id: "msg_03",
    direction: "inbound",
    author: "customer",
    body: "2:30 would be perfect. Is the glow package included?",
    createdAt: "2026-07-08T09:10:00Z",
  },
  {
    id: "msg_04",
    direction: "outbound",
    author: "human",
    body: "Booked you in for 2:30 — I'll add the glow add-on at no charge for a first visit. See you then!",
    createdAt: "2026-07-08T09:12:00Z",
  },
];

export const mockLeads: Lead[] = [
  {
    id: "lead_01",
    name: "Mara Klein",
    email: "mara@klein.io",
    source: "dm",
    score: 88,
    status: "qualified",
    stage: "Discovery call",
    dealAmount: 2400,
    dealStatus: "open",
    createdAt: "2026-07-08T08:40:00Z",
  },
  {
    id: "lead_02",
    name: "Devon Ruiz",
    email: "devon@ruiz.dev",
    source: "form",
    score: 72,
    status: "nurturing",
    stage: "New",
    dealAmount: null,
    dealStatus: null,
    createdAt: "2026-07-08T07:05:00Z",
  },
  {
    id: "lead_03",
    name: "Priya Nair",
    email: "priya@nair.co",
    source: "comment",
    score: 64,
    status: "new",
    stage: "New",
    dealAmount: null,
    dealStatus: null,
    createdAt: "2026-07-07T16:20:00Z",
  },
  {
    id: "lead_04",
    name: "Sam Wells",
    email: "sam@wells.co",
    source: "discovery",
    score: 91,
    status: "converted",
    stage: "Won",
    dealAmount: 4800,
    dealStatus: "won",
    createdAt: "2026-07-06T14:10:00Z",
  },
  {
    id: "lead_05",
    name: "Jordan Ellis",
    email: "jordan@ellis.me",
    source: "manual",
    score: 40,
    status: "unqualified",
    stage: "New",
    dealAmount: null,
    dealStatus: null,
    createdAt: "2026-07-06T11:00:00Z",
  },
];

function kpiSeries(): AnalyticsSnapshot["series"] {
  const days = 30;
  const start = Date.UTC(2026, 5, 9); // Jun 9, 2026
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start + i * 24 * 60 * 60 * 1000);
    const wave = Math.sin(i / 4);
    return {
      day: date.toISOString().slice(0, 10),
      reach: Math.round(3600 + i * 120 + wave * 800),
      engagement: Math.round(240 + i * 6 + wave * 90),
      leads: Math.round(8 + (i % 7) + Math.max(0, wave * 4)),
      revenue: Math.round(900 + i * 45 + Math.max(0, wave) * 600),
    };
  });
}

export const mockAnalytics: AnalyticsSnapshot = {
  series: kpiSeries(),
  topPosts: [
    {
      id: "post_01",
      platform: "instagram",
      reach: 18400,
      engagement: 2140,
      capturedAt: "2026-07-07T12:00:00Z",
    },
    {
      id: "post_02",
      platform: "tiktok",
      reach: 26800,
      engagement: 3120,
      capturedAt: "2026-07-06T12:00:00Z",
    },
    {
      id: "post_03",
      platform: "facebook",
      reach: 9200,
      engagement: 640,
      capturedAt: "2026-07-05T12:00:00Z",
    },
    {
      id: "post_04",
      platform: "youtube",
      reach: 7400,
      engagement: 510,
      capturedAt: "2026-07-04T12:00:00Z",
    },
    {
      id: "post_05",
      platform: "google",
      reach: 4100,
      engagement: 180,
      capturedAt: "2026-07-03T12:00:00Z",
    },
  ],
};

export const mockChannels: ConnectedChannel[] = [
  {
    provider: "instagram",
    status: "connected",
    handle: "@luminaskin.co",
    connectedAt: "2026-06-14T10:00:00Z",
  },
  {
    provider: "facebook",
    status: "connected",
    handle: "Lumina Skin Studio",
    connectedAt: "2026-06-14T10:02:00Z",
  },
  {
    provider: "tiktok",
    status: "disconnected",
    handle: null,
    connectedAt: null,
  },
  {
    provider: "google",
    status: "connected",
    handle: "Lumina Skin Studio",
    connectedAt: "2026-06-20T09:00:00Z",
  },
  {
    provider: "youtube",
    status: "disconnected",
    handle: null,
    connectedAt: null,
  },
  {
    provider: "email",
    status: "connected",
    handle: "owner@luminaskin.co",
    connectedAt: "2026-06-14T10:05:00Z",
  },
];

// `emailVerified: false` so the verify-email banner is visible in the demo
// build — demo intentionally shows the unverified state for verification.
export const mockOrgProfile: OrgProfile = {
  orgName: "Lumina Skin Studio",
  ownerName: "Ava Chen",
  ownerEmail: "ava@luminaskin.co",
  autonomy: "suggest",
  caps: {
    dailyPosts: 3,
    monthlyBudget: 1500,
    maxQuoteValue: 5000,
  },
  plan: "free",
  emailVerified: false,
};

export const mockMembers: OrgMember[] = [
  {
    userId: "usr_demo",
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
    name: "Priya Nair",
    role: "member",
  },
];

export const mockInvites: OrgInvite[] = [
  {
    id: "inv_01",
    email: "jordan@luminaskin.co",
    role: "marketer",
    status: "pending",
    invitedAt: "2026-07-09T15:30:00Z",
  },
];

/** Demo fallback for `getInvitePreview` — a brand-new invitee who must set a password. */
export const mockInvitePreview: InvitePreview = {
  orgName: "Lumina Skin Studio",
  email: "jordan@luminaskin.co",
  role: "marketer",
  needsPassword: true,
};

export const mockCalendar: CalendarEntry[] = [
  {
    id: "sp_01",
    platform: "instagram",
    scheduledFor: "2026-07-08T18:30:00Z",
    status: "scheduled",
    caption: "Hook-first reel with trending audio and a soft CTA to book.",
    format: "reel",
  },
  {
    id: "sp_02",
    platform: "facebook",
    scheduledFor: "2026-07-09T17:00:00Z",
    status: "scheduled",
    caption: "Educational carousel, 6 slides, brand-kit styled.",
    format: "carousel",
  },
  {
    id: "sp_03",
    platform: "tiktok",
    scheduledFor: "2026-07-09T20:00:00Z",
    status: "scheduled",
    caption: "Fast-cut talking-head script, on-screen captions.",
    format: "short_video",
  },
  {
    id: "sp_04",
    platform: "youtube",
    scheduledFor: "2026-07-11T16:00:00Z",
    status: "paused",
    caption: "Repurposed from the top-performing reel.",
    format: "short_video",
  },
  {
    id: "sp_05",
    platform: "google",
    scheduledFor: "2026-07-12T12:00:00Z",
    status: "scheduled",
    caption: "Local visibility update with July hours + booking link.",
    format: "post",
  },
];

// ─── Paginated fallbacks ───────────────────────────────────────────────────
// The list endpoints return a `Paginated<T>` envelope; these mirror that shape
// for demo mode by wrapping the full mock arrays as a single page.

export function mockContentPage(page = 1, limit = 20): Paginated<ContentItem> {
  return mockPage(mockContent, page, limit);
}

export function mockLeadsPage(page = 1, limit = 20): Paginated<Lead> {
  return mockPage(mockLeads, page, limit);
}

/** Demo KPI aggregate — derived from `mockLeads` so it stays consistent with the table. */
export const mockLeadSummary: LeadSummary = {
  total: mockLeads.length,
  qualified: mockLeads.filter(
    (l) => l.status === "qualified" || l.status === "converted",
  ).length,
  openPipeline: mockLeads.reduce(
    (sum, l) => sum + (l.dealStatus === "open" ? (l.dealAmount ?? 0) : 0),
    0,
  ),
  won: mockLeads.reduce(
    (sum, l) => sum + (l.dealStatus === "won" ? (l.dealAmount ?? 0) : 0),
    0,
  ),
};

export function mockConversationsPage(
  page = 1,
  limit = 20,
): Paginated<ConversationSummary> {
  return mockPage(mockConversations, page, limit);
}

export function mockCalendarPage(page = 1, limit = 20): Paginated<CalendarEntry> {
  return mockPage(mockCalendar, page, limit);
}
