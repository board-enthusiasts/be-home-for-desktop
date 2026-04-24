interface DetailRowProps {
  label: string;
  value: string;
}

/**
 * Renders one label-value pair using the shared desktop-shell chrome.
 */
export function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="desktop-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface StatusSummaryCardProps {
  title: string;
  summary: string;
  guidance: string;
}

/**
 * Renders a small status summary card used throughout the desktop shell.
 */
export function StatusSummaryCard({
  title,
  summary,
  guidance,
}: StatusSummaryCardProps) {
  return (
    <article className="desktop-status-band desktop-status-band--neutral">
      <div className="desktop-status-band-label">{title}</div>
      <h3>{summary}</h3>
      <p>{guidance}</p>
    </article>
  );
}

interface StatusChipProps {
  label: string;
  value: string;
}

/**
 * Renders a two-part capsule used for compact desktop shell summaries.
 */
export function StatusChip({ label, value }: StatusChipProps) {
  return (
    <span className="desktop-highlight">
      <span className="desktop-highlight-label">{label}</span>
      <span className="desktop-highlight-value">{value}</span>
    </span>
  );
}
