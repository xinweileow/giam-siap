import { shortAddress, suiscanTxUrl } from "@/lib/format";
import type { TxLogEntry } from "@/lib/types";

const ICONS: Record<TxLogEntry["kind"], string> = {
  created: "🔒",
  fulfilled: "✓",
  cancelled: "✗",
};

export default function TransactionLog({ entries }: { entries: TxLogEntry[] }) {
  return (
    <section className="panel">
      <h2 className="panel__title">Transaction Log</h2>
      {entries.length === 0 ? (
        <p className="empty-state">No transactions yet.</p>
      ) : (
        <ul className="tx-log">
          {entries.map((entry) => (
            <li key={entry.key} className="tx-log__entry">
              <span className="tx-log__icon">{ICONS[entry.kind]}</span>
              <span>{entry.summary}</span>
              <a
                className="tx-log__link"
                href={suiscanTxUrl(entry.digest)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shortAddress(entry.digest)} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
