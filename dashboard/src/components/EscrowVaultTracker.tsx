import { formatMistAsSui } from "@/lib/format";

export default function EscrowVaultTracker({
  lockedMist,
  settledMist,
}: {
  lockedMist: string;
  settledMist: string;
}) {
  return (
    <section className="panel">
      <h2 className="panel__title">Escrow Vault Tracker</h2>
      <div className="vault-cards">
        <div className="vault-card">
          <div className="vault-card__label">Locked in escrow</div>
          <div className="vault-card__value">{formatMistAsSui(lockedMist)} SUI</div>
        </div>
        <div className="vault-card">
          <div className="vault-card__label">Total settled</div>
          <div className="vault-card__value">{formatMistAsSui(settledMist)} SUI</div>
        </div>
      </div>
    </section>
  );
}
