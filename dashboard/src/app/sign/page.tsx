"use client";

import { useEffect, useState } from "react";
import { getEnokiFlow, getEnokiNetwork } from "@/lib/enokiFlow";

/**
 * `/sign?tx=<pendingId>` — the real per-order browser-signing step (§4.5 step 3: "happens at
 * EVERY order, not just first login"). Restores the owner's already-established Enoki session
 * (no repeat Google prompt — that's what `/auth` was for) and signs+submits the exact unsigned
 * transaction `createOrder`/`cancelOrder` built, using the resulting `EnokiKeypair` directly.
 *
 * Gas is Enoki-sponsored (§4.5's "owner never touches gas" promise, closed this session): rather
 * than submitting the owner's own fauceted-gas transaction directly, this page (1) asks the
 * server-side `POST /api/sponsor-transaction` to rebuild the pending tx as a sponsored one —
 * Enoki's gas-station coin pays gas, not the owner's — (2) signs the *sponsored* bytes that
 * returns with the owner's own `EnokiKeypair` (the owner still authorizes their own spend, only
 * the gas coin is someone else's), and (3) hands that signature to
 * `POST /api/sponsor-transaction/execute`, which submits it via Enoki's
 * `executeSponsoredTransaction`. The private `ENOKI_SECRET_KEY` both server routes need never
 * reaches this page — see `dashboard/src/lib/enokiServer.ts`.
 */
type Phase = "loading" | "needs-login" | "ready" | "submitting" | "done" | "error";

interface PendingTxRecord {
  id: string;
  kind: "createOrder" | "cancelOrder";
  ownerAddress: string;
  unsignedTxBytesBase64: string;
  status: "pending" | "submitted" | "failed";
  digest?: string;
}

export default function SignPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [record, setRecord] = useState<PendingTxRecord | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pendingId = new URL(window.location.href).searchParams.get("tx");
    if (!pendingId) {
      setError("Missing ?tx=<id> in the URL — use the link Hermes sent you.");
      setPhase("error");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/pending-tx/${pendingId}`);
        if (!res.ok) throw new Error(`No pending transaction found for id ${pendingId}`);
        const rec: PendingTxRecord = await res.json();
        setRecord(rec);

        if (rec.status === "submitted") {
          setDigest(rec.digest ?? null);
          setPhase("done");
          return;
        }

        const flow = getEnokiFlow();
        const session = await flow.getSession();
        if (!session) {
          // No active browser session — bounce through /auth to (re-)establish one, then come
          // straight back here to finish approving this exact transaction (§4.5 step 3's "one
          // tap" flow, not a dead end requiring the owner to manually navigate back).
          window.location.href = `/auth?returnTo=${encodeURIComponent(window.location.href)}`;
          return;
        }
        setPhase("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
  }, []);

  async function signAndSubmit() {
    if (!record) return;
    setPhase("submitting");
    try {
      const flow = getEnokiFlow();
      const keypair = await flow.getKeypair({ network: getEnokiNetwork() });
      if (keypair.toSuiAddress().toLowerCase() !== record.ownerAddress.toLowerCase()) {
        throw new Error(
          `Signed-in address (${keypair.toSuiAddress()}) doesn't match this order's owner (${record.ownerAddress}) — sign in with the same Google account you used originally.`,
        );
      }

      // Step 1: server rebuilds this pending tx as an Enoki-sponsored one (its gas station pays
      // gas, not the owner) and returns the sponsored bytes + Enoki's own tracking digest.
      const sponsorRes = await fetch("/api/sponsor-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingTxId: record.id }),
      });
      const sponsored = await sponsorRes.json();
      if (!sponsorRes.ok) {
        throw new Error(sponsored?.error ?? `Sponsorship request failed (HTTP ${sponsorRes.status})`);
      }

      // Step 2: the owner signs the SPONSORED bytes (not the original unsigned bytes — those
      // carried the owner's own gas coin; the sponsored bytes carry Enoki's instead).
      const sponsoredBytes = new Uint8Array(Buffer.from(sponsored.bytes, "base64"));
      const { signature } = await keypair.signTransaction(sponsoredBytes);

      // Step 3: hand the signature to the server, which submits it via Enoki's
      // executeSponsoredTransaction (keyed by digest — no need to resend the tx bytes).
      const execRes = await fetch("/api/sponsor-transaction/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingTxId: record.id, digest: sponsored.digest, signature }),
      });
      const executed = await execRes.json();
      if (!execRes.ok) {
        throw new Error(executed?.error ?? `Submission failed (HTTP ${execRes.status})`);
      }

      setDigest(executed.digest);
      setPhase("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (record) {
        await fetch(`/api/pending-tx/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "failed", error: message }),
        }).catch(() => {});
      }
      setPhase("error");
    }
  }

  return (
    <main className="dashboard auth-page">
      <header className="dashboard__header">
        <h1>Giam Siap — Approve transaction</h1>
      </header>

      {phase === "loading" && <p className="empty-state">Loading…</p>}

      {phase === "needs-login" && (
        <p className="warning-banner">
          Your session isn&apos;t active in this browser. <a href="/auth">Sign in again</a>, then reopen this link.
        </p>
      )}

      {phase === "ready" && record && (
        <section className="panel">
          <p>
            Approve this <strong>{record.kind === "createOrder" ? "procurement order" : "order cancellation"}</strong>?
            This will submit a real transaction on Sui testnet.
          </p>
          <button className="button" onClick={signAndSubmit}>
            Approve &amp; submit
          </button>
        </section>
      )}

      {phase === "submitting" && <p className="empty-state">Signing and submitting…</p>}

      {phase === "done" && digest && (
        <section className="panel">
          <p>Done. You can close this tab and return to Telegram.</p>
          <a className="mono" href={`https://suiscan.xyz/testnet/tx/${digest}`} target="_blank" rel="noreferrer">
            View on Suiscan →
          </a>
        </section>
      )}

      {phase === "error" && <p className="error-banner">Something went wrong: {error}</p>}
    </main>
  );
}
