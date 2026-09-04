export default function ConnectionIndicator({
  connected,
  network,
}: {
  connected: boolean;
  network: string;
}) {
  return (
    <span className={`connection-indicator ${connected ? "connection-indicator--live" : "connection-indicator--down"}`}>
      <span className="connection-indicator__dot" aria-hidden="true">
        ●
      </span>{" "}
      {connected ? `Live (${network})` : "Reconnecting…"}
    </span>
  );
}
