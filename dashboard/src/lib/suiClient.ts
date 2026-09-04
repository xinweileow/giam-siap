import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Config } from "./config";

/** Same migration story as agent/sui-mcp/src/suiClient.ts: the public testnet fullnode removed
 * the JSON-RPC method the old `SuiClient` transaction/query path depended on — use the gRPC
 * `SuiGrpcClient` (`listEvents`, `getObject`) instead, never `queryEvents`. */
export function makeSuiClient(config: Config): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.rpcUrl });
}
