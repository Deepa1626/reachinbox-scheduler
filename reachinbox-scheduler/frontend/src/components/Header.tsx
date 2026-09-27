import { UserProfile } from "@/types";
import { api, endpoints } from "@/lib/api";
import { useRouter } from "next/router";

export default function Header({ user }: { user: UserProfile }) {
  const router = useRouter();

  async function handleLogout() {
    await api.post("/api/auth/logout");
    router.push("/");
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-brand-500" />
        <span className="text-lg font-semibold">ReachInbox Scheduler</span>
      </div>

      <div className="flex items-center gap-4">
        {user.slackConnected ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            Slack connected
          </span>
        ) : (
          <a
            href={endpoints.slackConnectUrl}
            className="rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-200"
          >
            Connect Slack
          </a>
        )}

        <div className="flex items-center gap-2">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt={user.name || user.email} className="h-8 w-8 rounded-full" />
          )}
          <div className="text-sm leading-tight">
            <div className="font-medium">{user.name || user.email}</div>
            <div className="text-gray-500">{user.email}</div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
