const STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  queued: "bg-indigo-100 text-indigo-700",
  sending: "bg-yellow-100 text-yellow-700",
  rescheduled: "bg-orange-100 text-orange-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status] || "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}
