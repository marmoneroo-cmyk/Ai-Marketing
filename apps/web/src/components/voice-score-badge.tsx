import { Badge } from "@/components/ui/badge";

interface VoiceScoreBadgeProps {
  /** Brand-voice conformance score, 0..100. */
  score: number;
}

const STRONG_THRESHOLD = 75;
const FAIR_THRESHOLD = 50;

/**
 * Brand-voice conformance badge, colored by threshold: >=75 reads as on-brand
 * (success), >=50 as borderline (warning), and below that as off-brand (danger).
 */
export function VoiceScoreBadge({ score }: VoiceScoreBadgeProps) {
  const tone =
    score >= STRONG_THRESHOLD
      ? "success"
      : score >= FAIR_THRESHOLD
        ? "warning"
        : "danger";

  return (
    <Badge tone={tone}>
      <span aria-hidden="true">Voice</span>
      <span className="sr-only">Brand voice score</span> {score}
    </Badge>
  );
}
