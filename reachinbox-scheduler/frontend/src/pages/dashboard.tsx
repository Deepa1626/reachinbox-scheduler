import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { UserProfile, EmailJob } from "@/types";
import Header from "@/components/Header";
import Tabs, { TabKey } from "@/components/Tabs";
import ScheduledTable from "@/components/ScheduledTable";
import SentTable from "@/components/SentTable";
import ComposeModal from "@/components/ComposeModal";
import { Button } from "@/components/ui";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [tab, setTab] = useState<TabKey>("scheduled");
  const [scheduled, setScheduled] = useState<EmailJob[]>([]);
  const [sent, setSent] = useState<EmailJob[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [composing, setComposing] = useState(false);

  const loadUser = useCallback(async () => {
    try {
      const { data } = await api.get("/api/auth/me");
      setUser(data);
    } catch {
      router.replace("/");
    } finally {
      setLoadingUser(false);
    }
  }, [router]);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const [s1, s2] = await Promise.all([api.get("/api/emails/scheduled"), api.get("/api/emails/sent")]);
      setScheduled(s1.data.items);
      setSent(s2.data.items);
    } catch {
      toast.error("Failed to load emails");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!user) return;
    loadRows();
    // Poll every 5s so status changes (queued -> sending -> sent, or rate-limit
    // reschedules) show up live without a manual refresh.
    const id = setInterval(loadRows, 5000);
    return () => clearInterval(id);
  }, [user, loadRows]);

  useEffect(() => {
    if (router.query.slack === "connected") toast.success("Slack connected!");
    if (router.query.slack === "error") toast.error("Slack connection failed");
  }, [router.query]);

  if (loadingUser || !user) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-gray-500">Manage your scheduled and sent email campaigns.</p>
          </div>
          <Button onClick={() => setComposing(true)}>+ Compose New Email</Button>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-2 pt-2">
            <Tabs active={tab} onChange={setTab} />
          </div>
          {tab === "scheduled" ? (
            <ScheduledTable items={scheduled} loading={loadingRows} />
          ) : (
            <SentTable items={sent} loading={loadingRows} />
          )}
        </div>
      </main>

      {composing && <ComposeModal onClose={() => setComposing(false)} onScheduled={loadRows} />}
    </div>
  );
}
