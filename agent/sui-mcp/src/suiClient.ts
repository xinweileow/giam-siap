import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import type { Config } from "./config.js";

/** JSON-RPC methods this SDK relied on for tx-building resolution were removed from public
 * fullnodes (see docs.sui.io/develop/accessing-data/json-rpc-migration) — use gRPC instead. */
export function makeSuiClient(config: Config): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.rpcUrl });
}

/** The AgentCap signer — a plain Ed25519 keypair, not a zkLogin address (§4.5). */
export function makeAgentKeypair(config: Config): Ed25519Keypair {
  const { secretKey, scheme } = decodeSuiPrivateKey(config.agentPrivateKey);
  if (scheme !== "ED25519") {
    throw new Error(`Expected an ed25519 AGENT_PRIVATE_KEY, got ${scheme}`);
  }
  return Ed25519Keypair.fromSecretKey(secretKey);
}
