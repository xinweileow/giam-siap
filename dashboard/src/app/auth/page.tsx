"use client";

import { useEffect, useState } from "react";
import { getEnokiFlow, getGoogleClientId, getEnokiNetwork } from "@/lib/enokiFlow";
import { formatCentsAsMyr, shortAddress } from "@/lib/format";
import type { DashboardSnapshot, OrderRow } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

/**
 * `/auth?telegramUserId=<id>` — the owner's sign-in page (§4.5 step 2), and now also the "landing
 * page" for a returning owner with nothing pending to approve: it shows their own orders and a
 * reminder to message the bot for a new one, rather than a bare "you're signed in" dead end.
 *
 * `?returnTo=<url>` — if present (set by /sign when it needs a fresh login), redirects there
 * immediately after sign-in instead of showing the orders list, so a re-login round-trips back to
 * the transaction the owner was trying to approve.
 *
 * Google's OAuth redirect strips query params and returns an implicit-flow token in the URL
 * *hash* instead — telegramUserId/returnTo are stashed in localStorage before redirecting out,
 * and read back after `handleAuthCallback` resolves, since they wouldn't otherwise survive the
 * round trip.
 */
const TELEGRAM_USER_ID_KEY = "giam-siap:pending-telegram-user-id";
const RETURN_TO_KEY = "giam-siap:pending-return-to";

type Phase = "loading" | "needs-login" | "signed-in" | "error";

export default function AuthPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegramUserId, setTelegramUserId] = useState<string | null>(null);
  const [myOrders, setMyOrders] = useState<OrderRow[] | null>(null);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [faucetRequested, setFaucetRequested] = useState(false);
  const [alreadyFunded, setAlreadyFunded] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("telegramUserId");
    const returnToFromQuery = url.searchParams.get("returnTo");
    if (fromQuery) {
      localStorage.setItem(TELEGRAM_USER_ID_KEY, fromQuery);
      setTelegramUserId(fromQuery);
    } else {
      setTelegramUserId(localStorage.getItem(TELEGRAM_USER_ID_KEY));
    }
    if (returnToFromQuery) {
      localStorage.setItem(RETURN_TO_KEY, returnToFromQuery);
    }

    (async () => {
      try {
        const flow = getEnokiFlow();

        // Returning from Google's OAuth redirect (implicit-flow token lives in the URL hash).
        if (window.location.hash) {
          const resolvedAddress = await flow.handleAuthCallback(window.location.hash);
          history.replaceState(null, "", url.pathname + url.search); // drop the token from the URL bar
          if (resolvedAddress) {
            await finishSignIn(resolvedAddress, fromQuery ?? localStorage.getItem(TELEGRAM_USER_ID_KEY));
            return;
          }
        }

        // Already-restored session from a previous visit (no repeat Google prompt, §4.5 step 2).
        const session = await flow.getSession();
        if (session) {
          const keypair = await flow.getKeypair({ network: getEnokiNetwork() });
          await finishSignIn(keypair.toSuiAddress(), fromQuery ?? localStorage.getItem(TELEGRAM_USER_ID_KEY));
          return;
        }

        setPhase("needs-login");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishSignIn(resolvedAddress: string, forTelegramUserId: string | null) {
    setAddress(resolvedAddress);
    if (forTelegramUserId) {
      await fetch("/api/owner-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramUserId: forTelegramUserId, address: resolvedAddress }),
      });

      // Check balance FIRST — the faucet call used to fire unconditionally on every sign-in, so
      // an already well-funded returning owner saw a scary "funding failed" message any time the
      // public faucet happened to be rate-limited, for no reason (it never needed the coins).
      // Below this threshold counts as "genuinely needs funding"; anything above it skips the
      // faucet call entirely — gas is sponsored now anyway, so the owner only ever needs enough
      // for the escrow amount itself, and this is comfortably more than any real order needs.
      const LOW_BALANCE_THRESHOLD_MIST = 10_000_000; // 0.01 SUI
      let needsFaucet = true;
      try {
        const balanceRes = await fetch(`/api/balance?address=${resolvedAddress}`);
        if (balanceRes.ok) {
          const { balanceMist } = await balanceRes.json();
          needsFaucet = BigInt(balanceMist) < BigInt(LOW_BALANCE_THRESHOLD_MIST);
        }
        // If the balance check itself failed, fall through and still try the faucet — we don't
        // know either way, and requesting funds for an already-funded address is harmless.
      } catch {
        // Same fallback as above.
      }

      if (!needsFaucet) {
        setAlreadyFunded(true);
      } else {
        // A faucet failure (e.g. the public testnet faucet rate-limiting, a real 429 seen in
        // practice) shouldn't block showing the owner their address — but it also shouldn't be
        // silently swallowed into a false "funded" message. Check the response and, on failure,
        // tell the owner honestly instead of claiming success regardless.
        setFaucetRequested(true);
        try {
          const faucetRes = await fetch("/api/faucet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: resolvedAddress }),
          });
          if (!faucetRes.ok) {
            setFaucetError(
              "Funding request failed — the testnet faucet may be rate-limited. You can retry in a minute, or ask someone to send you testnet SUI directly.",
            );
          }
        } catch {
          setFaucetError(
            "Funding request failed — the testnet faucet may be rate-limited. You can retry in a minute, or ask someone to send you testnet SUI directly.",
          );
        }
      }
    }

    const returnTo = localStorage.getItem(RETURN_TO_KEY);
    if (returnTo) {
      localStorage.removeItem(RETURN_TO_KEY);
      window.location.href = returnTo;
      return; // navigating away — don't bother loading the orders list below
    }

    setPhase("signed-in");
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        const snapshot: DashboardSnapshot = await res.json();
        setMyOrders(snapshot.orders.filter((o) => o.owner.toLowerCase() === resolvedAddress.toLowerCase()));
      }
    } catch {
      // Orders list is a nice-to-have on this page, not load-bearing — swallow and show nothing.
    }
  }

  async function signIn() {
    try {
      const flow = getEnokiFlow();
      const redirectUrl = `${window.location.origin}/auth`;
      const authUrl = await flow.createAuthorizationURL({
        provider: "google",
        clientId: getGoogleClientId(),
        redirectUrl,
        network: getEnokiNetwork(),
      });
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <main className="dashboard auth-page">
      <header className="dashboard__header">
        <h1>Giam Siap — Sign in</h1>
      </header>

      {phase === "loading" && <p className="empty-state">Checking your session…</p>}

      {phase === "needs-login" && (
        <section className="panel">
          <p>Sign in with Google to get a Sui address (zkLogin — no wallet, no seed phrase).</p>
          {!telegramUserId && (
            <p className="warning-banner">
              No telegramUserId found — open this page from the link Hermes sends you in Telegram.
            </p>
          )}
          <button className="button" onClick={signIn}>
            Sign in with Google
          </button>
        </section>
      )}

      {phase === "signed-in" && address && (
        <>
          <section className="panel">
            <h2 className="panel__title">Your address</h2>
            <code className="address-block">{address}</code>
            {faucetError && <p className="warning-banner">{faucetError}</p>}
            {!faucetError && faucetRequested && (
              <p className="empty-state">A small amount of testnet SUI has been requested for you.</p>
            )}
            {alreadyFunded && <p className="empty-state">This address already has enough testnet SUI.</p>}
          </section>

          <section className="panel">
            <h2 className="panel__title">Your orders</h2>
            {myOrders === null && <p className="empty-state">Loading your orders…</p>}
            {myOrders !== null && myOrders.length === 0 && (
              <p className="empty-state">No orders yet — message the bot in Telegram to start one.</p>
            )}
            {myOrders !== null && myOrders.length > 0 && (
              <ul className="order-list">
                {myOrders.map((o) => (
                  <li key={o.id} className="order-list__item">
                    <span className="mono">{shortAddress(o.id, 8, 6)}</span>
                    <span>
                      Target {formatCentsAsMyr(o.targetPriceCents)} × {o.quantity}
                      {o.settledPriceCents !== null && ` (settled at ${formatCentsAsMyr(o.settledPriceCents)})`}
                    </span>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="auth-page__hint">
            To start a new order or check on one, just message the bot in Telegram — you can close this tab.
          </p>
        </>
      )}

      {phase === "error" && <p className="error-banner">Something went wrong: {error}</p>}
    </main>
  );
}
