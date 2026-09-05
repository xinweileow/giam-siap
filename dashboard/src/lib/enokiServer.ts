import { EnokiClient } from "@mysten/enoki";

let client: EnokiClient | null = null;

/**
 * Server-only `EnokiClient` singleton, holding the PRIVATE `ENOKI_SECRET_KEY` — never a
 * `NEXT_PUBLIC_` var, never sent to the browser (unlike `dashboard/src/lib/enokiFlow.ts`'s
 * client-side `EnokiFlow`, which only ever holds the public API key). Backs real gas
 * sponsorship (`createSponsoredTransaction` / `executeSponsoredTransaction`, §4.5's "owner never
 * touches gas" promise, TODOS.md's gas-sponsorship item) from the two
 * `/api/sponsor-transaction*` routes — both calls happen through this same client (or an
 * equivalent one built from the same secret key; Enoki tracks a sponsorship session server-side
 * by `digest`, not by JS object identity) since only the backend may ever hold this key.
 */
export function getEnokiServerClient(): EnokiClient {
  const apiKey = process.env.ENOKI_SECRET_KEY;
  if (!apiKey) {
    throw new Error("ENOKI_SECRET_KEY is not set (server-only secret) — see dashboard/.env.example");
  }
  if (!client) {
    client = new EnokiClient({ apiKey });
  }
  return client;
}
