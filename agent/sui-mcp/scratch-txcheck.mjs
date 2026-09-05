import { SuiGrpcClient } from "@mysten/sui/grpc";

const c = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });
const pkg = "0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f";
for (const name of ["OrderCreated"]) {
  let after;
  let hasNext = true;
  while (hasNext) {
    const page = await c.listEvents({
      filter: { eventType: `${pkg}::procurement::${name}` },
      order: "descending",
      after,
    });
    for (const ev of page.events) {
      console.log(name, JSON.stringify(ev.json), "tx:", ev.transactionDigest, "cp:", ev.checkpoint);
    }
    after = page.endCursor ?? undefined;
    hasNext = page.hasNextPage;
    if (!after) break;
  }
}
