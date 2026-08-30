import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PhoneCall, Bot, Users, Timer } from "lucide-react";
import { Link } from "react-router";

export default function Dashboard() {
  const stats = trpc.calls.stats.useQuery();

  const cards = [
    { label: "Total calls", value: stats.data?.totalCalls ?? 0, icon: PhoneCall },
    { label: "Active calls", value: stats.data?.activeCalls ?? 0, icon: Timer },
    { label: "Agents", value: stats.data?.agents ?? 0, icon: Bot },
    { label: "Contacts", value: stats.data?.contacts ?? 0, icon: Users },
  ];

  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm text-muted-foreground">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="text-3xl font-bold">{stats.isLoading ? "…" : c.value}</CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>Recent calls</CardTitle></CardHeader>
          <CardContent>
            {stats.data?.recentCalls.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No calls yet. <Link className="underline" to="/calls">Place your first call</Link>.
              </p>
            )}
            <div className="space-y-2">
              {stats.data?.recentCalls.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                  <span className="font-mono">{c.direction === "outbound" ? c.toNumber : c.fromNumber}</span>
                  <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                  <Badge variant={c.status === "completed" ? "default" : "secondary"}>{c.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  );
}
