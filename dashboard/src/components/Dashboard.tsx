"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import ConnectionIndicator from "./ConnectionIndicator";
import EscrowVaultTracker from "./EscrowVaultTracker";
import LiveOrderTable from "./LiveOrderTable";
import TransactionLog from "./TransactionLog";

const POLL_INTERVAL_MS = 5000;

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  // Tracks a fetch-level failure (network error, non-2xx) separately from the snapshot's own
  // `connected` flag (an upstream RPC failure the server already recovered gracefully from) —
  // either one means "show reconnecting, don't freeze" per §9.1's dashboard row.
  const [fetchFailed, setFetchFailed] = useState(false);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/state responded ${res.status}`);
      const data: DashboardSnapshot = await res.json();
      setSnapshot(data);
      setFetchFailed(false);
    } catch {
      setFetchFailed(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const connected = !fetchFailed && (snapshot?.connected ?? false);

  return (
    <main className="dashboard">
      <header className="dashboard__header">
        <h1>Giam Siap — Escrow Monitor</h1>
        <ConnectionIndicator connected={connected} network={snapshot?.network ?? "testnet"} />
      </header>

      {!snapshot ? (
        <p className="empty-state">Connecting to testnet…</p>
      ) : (
        <>
          <EscrowVaultTracker lockedMist={snapshot.totals.lockedMist} settledMist={snapshot.totals.settledMist} />
          <LiveOrderTable orders={snapshot.orders} />
          <TransactionLog entries={snapshot.txLog} />
          {!connected && snapshot.lastError && (
            <p className="error-banner">Last error: {snapshot.lastError}</p>
          )}
        </>
      )}
    </main>
  );
}
