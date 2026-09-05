import { formatCentsAsMyr, shortAddress } from "@/lib/format";
import { STATUS_FULFILLED, type OrderRow } from "@/lib/types";
import StatusBadge from "./StatusBadge";

function currentPriceCell(order: OrderRow): string {
  if (order.status === STATUS_FULFILLED && order.settledPriceCents !== null) {
    return formatCentsAsMyr(order.settledPriceCents);
  }
  if (order.status === STATUS_FULFILLED) {
    // Settled on-chain, but the OrderFulfilled event carrying the price hasn't shown up in our
    // event stream yet — object reads are immediately consistent, events trail slightly.
    return "Settling…";
  }
  // No on-chain field ever stores a "current vendor price" for a still-Locked order (§3) — that
  // number only exists transiently in the watcher's process, which this dashboard doesn't call.
  return "Monitoring…";
}

export default function LiveOrderTable({ orders }: { orders: OrderRow[] }) {
  return (
    <section className="panel">
      <h2 className="panel__title">Live Order Table</h2>
      {orders.length === 0 ? (
        <p className="empty-state">No orders yet — waiting for the first OrderCreated event.</p>
      ) : (
        <div className="table-scroll">
          <table className="order-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Owner</th>
                <th>Target</th>
                <th>Current</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="mono">{shortAddress(order.id)}</td>
                  <td className="mono">{shortAddress(order.owner)}</td>
                  <td>{formatCentsAsMyr(order.targetPriceCents)}</td>
                  <td>{currentPriceCell(order)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
