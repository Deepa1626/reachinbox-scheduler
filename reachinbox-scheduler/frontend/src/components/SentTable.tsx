import { EmailJob } from "@/types";
import StatusBadge from "./StatusBadge";
import EmptyState from "./EmptyState";

export default function SentTable({ items, loading }: { items: EmailJob[]; loading: boolean }) {
  if (loading) {
    return <div className="animate-pulse space-y-2 p-6">{[...Array(5)].map((_, i) => <div key={i} className="h-10 rounded bg-gray-100" />)}</div>;
  }
  if (items.length === 0) {
    return <EmptyState title="No sent emails yet" subtitle="Sent emails will show up here once your scheduled jobs go out." />;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-gray-200 text-gray-500">
        <tr>
          <th className="py-3 pl-6 font-medium">Email</th>
          <th className="py-3 font-medium">Subject</th>
          <th className="py-3 font-medium">Sent time</th>
          <th className="py-3 pr-6 font-medium">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {items.map((job) => (
          <tr key={job.id} className="hover:bg-gray-50">
            <td className="py-3 pl-6">{job.recipient_email}</td>
            <td className="py-3">{job.subject}</td>
            <td className="py-3">{job.sent_at ? new Date(job.sent_at).toLocaleString() : "-"}</td>
            <td className="py-3 pr-6"><StatusBadge status={job.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
