import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhoneCall, Bot, Users, Timer, Phone } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";

export default function Dashboard() {
  const stats = trpc.calls.stats.useQuery();
  const agents = trpc.agents.list.useQuery();
  const utils = trpc.useUtils();
  const [testCallStatus, setTestCallStatus] = useState<{
    state: "idle" | "placing" | "done" | "error";
    message?: string;
    callSid?: string;
  }>({ state: "idle" });

  const placeTestCall = trpc.calls.placeCall.useMutation({
    onSuccess: (res) => {
      setTestCallStatus({
        state: "done",
        message: `Test call placed. SID: ${res.callSid}`,
        callSid: res.callSid,
      });
      void utils.calls.stats.invalidate();
      void utils.calls.list.invalidate();
    },
    onError: (err) => {
      setTestCallStatus({
        state: "error",
        message: err.message,
      });
    },
  });

  const onTestCall = () => {
    const outboundAgents = (agents.data ?? []).filter(
      (a: any) => a.active && a.vertical?.direction !== "inbound",
    );
    const first = outboundAgents[0] as any;
    if (!first) {
      setTestCallStatus({
        state: "error",
        message: "No active outbound agent. Create one in /agents first.",
      });
      return;
    }
    setTestCallStatus({ state: "placing" });
    placeTestCall.mutate({
      agentConfigId: first.id,
      to: "+17543529826", // default test number
      leadName: "Dashboard test call",
    });
  };

  const cards = [
    { label: "Total calls", value: stats.data?.totalCalls ?? 0, icon: PhoneCall },
    { label: "Active calls", value: stats.data?.activeCalls ?? 0, icon: Timer },
    { label: "Agents", value: stats.data?.agents ?? 0, icon: Bot },
    { label: "Contacts", value: stats.data?.contacts ?? 0, icon: Users },
  ];

  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onTestCall}
              disabled={testCallStatus.state === "placing"}
            >
              <Phone className="h-4 w-4 mr-2" />
              {testCallStatus.state === "placing" ? "Placing…" : "Test call"}
            </Button>
          </div>
        </div>

        {testCallStatus.state === "done" && (
          <div className="rounded-md border border-green-300/60 bg-green-50 dark:bg-green-950/30 dark:border-green-700/40 p-3 text-sm">
            <strong className="text-green-900 dark:text-green-200">Call placed.</strong>{" "}
            <span className="text-muted-foreground">
              {testCallStatus.message}
            </span>{" "}
            <Link className="underline" to="/calls">
              View in Calls
            </Link>
          </div>
        )}
        {testCallStatus.state === "error" && (
          <div className="rounded-md border border-red-300/60 bg-red-50 dark:bg-red-950/30 dark:border-red-700/40 p-3 text-sm">
            <strong className="text-red-900 dark:text-red-200">Failed.</strong>{" "}
            <span className="text-muted-foreground">{testCallStatus.message}</span>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm text-muted-foreground">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="text-3xl font-bold">
                {stats.isLoading ? "…" : c.value}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent calls</CardTitle>
          </CardHeader>
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
                  <span className="text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                  <Badge variant={c.status === "completed" ? "default" : "secondary"}>
                    {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  );
}
