import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Field, Input, Textarea, Button } from "./ui";

export default function ComposeModal({ onClose, onScheduled }: { onClose: () => void; onScheduled: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/api/emails/parse-leads", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setEmails(data.emails);
      toast.success(`Detected ${data.count} email address${data.count === 1 ? "" : "es"}`);
    } catch {
      toast.error("Failed to parse file");
    } finally {
      setParsing(false);
    }
  }

  async function handleSchedule() {
    if (!subject || !body || emails.length === 0 || !startTime) {
      toast.error("Fill in subject, body, a leads file, and a start time.");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/api/emails/schedule", {
        subject,
        body,
        recipients: emails,
        startTime: new Date(startTime).toISOString(),
        delayMs,
        hourlyLimit,
      });
      toast.success(`Scheduled ${data.scheduled} email(s)`);
      onScheduled();
      onClose();
    } catch {
      toast.error("Failed to schedule emails");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compose new email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-4">
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick question about {{company}}" />
          </Field>

          <Field label="Body">
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {{firstName}}, ..." />
          </Field>

          <Field label="Leads (CSV or text file)">
            <input type="file" accept=".csv,.txt" onChange={handleFile} className="block w-full text-sm" />
            {parsing && <p className="mt-1 text-xs text-gray-400">Parsing file…</p>}
            {!parsing && fileName && (
              <p className="mt-1 text-xs text-gray-500">
                {fileName} — {emails.length} email address{emails.length === 1 ? "" : "es"} detected
              </p>
            )}
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Start time">
              <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Delay (ms)">
              <Input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} />
            </Field>
            <Field label="Emails / hour">
              <Input type="number" min={1} value={hourlyLimit} onChange={(e) => setHourlyLimit(Number(e.target.value))} />
            </Field>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSchedule} disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
