import { STATUS_CANCELLED, STATUS_FULFILLED, STATUS_LOCKED } from "@/lib/types";

const LABELS: Record<number, string> = {
  [STATUS_LOCKED]: "MONITORING",
  [STATUS_FULFILLED]: "EXECUTED",
  [STATUS_CANCELLED]: "CANCELLED",
};

const DOTS: Record<number, string> = {
  [STATUS_LOCKED]: "🟡",
  [STATUS_FULFILLED]: "🟢",
  [STATUS_CANCELLED]: "⚪",
};

export default function StatusBadge({ status }: { status: number }) {
  const label = LABELS[status] ?? `UNKNOWN(${status})`;
  const dot = DOTS[status] ?? "🔴";
  return (
    <span className={`status-badge status-badge--${status}`}>
      {dot} {label}
    </span>
  );
}
