import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Calendar as CalendarIcon,
  Mail,
  PhoneCall,
  Bell,
  Plug,
  Trash2,
  Plus,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, { label: string; description: string; tab: string }> = {
  google_calendar: { label: "Google Calendar", description: "Read & write your Google Calendar.", tab: "calendar" },
  outlook_calendar: { label: "Outlook Calendar", description: "Read & write your Outlook calendar.", tab: "calendar" },
  google_gmail: { label: "Gmail", description: "Read your inbox, draft replies.", tab: "email" },
  microsoft_graph: { label: "Outlook (Microsoft Graph)", description: "Outlook email + calendar.", tab: "email" },
};

export default function Assistant() {
  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">AI Executive Assistant</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your AI assistant handles inbound calls, places outbound calls on your behalf,
            books meetings, drafts emails, and remembers notes about people.
            All actions are HIPAA-grade and audit-logged.
          </p>
        </div>

        <Tabs defaultValue="integrations">
          <TabsList>
            <TabsTrigger value="integrations"><Plug className="h-4 w-4 mr-1.5" />Integrations</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarIcon className="h-4 w-4 mr-1.5" />Calendar</TabsTrigger>
            <TabsTrigger value="email"><Mail className="h-4 w-4 mr-1.5" />Email</TabsTrigger>
            <TabsTrigger value="calls"><PhoneCall className="h-4 w-4 mr-1.5" />Calls</TabsTrigger>
            <TabsTrigger value="reminders"><Bell className="h-4 w-4 mr-1.5" />Reminders</TabsTrigger>
          </TabsList>
          <TabsContent value="integrations" className="mt-4"><IntegrationsTab /></TabsContent>
          <TabsContent value="calendar" className="mt-4"><CalendarTab /></TabsContent>
          <TabsContent value="email" className="mt-4"><EmailTab /></TabsContent>
          <TabsContent value="calls" className="mt-4"><CallsTab /></TabsContent>
          <TabsContent value="reminders" className="mt-4"><RemindersTab /></TabsContent>
        </Tabs>
      </div>
    </AuthLayout>
  );
}

// ── Integrations tab ────────────────────────────────────────────────────
function IntegrationsTab() {
  const utils = trpc.useUtils();
  const { data: integrations } = trpc.assistant.listIntegrations.useQuery();
  const startConnect = trpc.assistant.startConnectIntegration.useMutation({
    onSuccess: (r) => {
      // Redirect to the OAuth callback URL (mock flow completes immediately)
      window.location.href = r.authUrl;
    },
    onError: (e) => toast.error(e.message),
  });
  const disconnect = trpc.assistant.disconnectIntegration.useMutation({
    onSuccess: () => {
      toast.success("Disconnected");
      void utils.assistant.listIntegrations.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const providers = Object.keys(PROVIDER_LABELS);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {providers.map((p) => {
        const meta = PROVIDER_LABELS[p]!;
        const integration = (integrations ?? []).find((i) => i.provider === p);
        const status = integration?.status ?? "disconnected";
        return (
          <Card key={p}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{meta.label}</CardTitle>
                  <CardDescription>{meta.description}</CardDescription>
                </div>
                <StatusBadge status={status} />
              </div>
            </CardHeader>
            <CardContent>
              {integration?.externalUserEmail && (
                <p className="text-xs text-muted-foreground mb-3">
                  Connected as <span className="font-mono">{integration.externalUserEmail}</span>
                </p>
              )}
              {status === "connected" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnect.mutate({ provider: p as any })}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => startConnect.mutate({ provider: p as any })}
                  disabled={startConnect.isPending}
                >
                  <Plug className="h-3.5 w-3.5 mr-1.5" />
                  Connect (mock)
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: "default" | "secondary" | "destructive" | "outline" = "outline";
  const Icon = status === "connected" ? CheckCircle2 : status === "error" || status === "expired" ? XCircle : AlertCircle;
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

// ── Calendar tab ───────────────────────────────────────────────────────
function CalendarTab() {
  const utils = trpc.useUtils();
  const { data: events } = trpc.assistant.listCalendarEvents.useQuery({});
  const create = trpc.assistant.createCalendarEvent.useMutation({
    onSuccess: () => {
      toast.success("Event created");
      void utils.assistant.listCalendarEvents.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.assistant.cancelCalendarEvent.useMutation({
    onSuccess: () => {
      toast.success("Event cancelled");
      void utils.assistant.listCalendarEvents.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const submit = () => {
    if (!title || !start || !end) {
      toast.error("Title, start, and end are required.");
      return;
    }
    create.mutate({
      title,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New event</CardTitle>
          <CardDescription>
            Book a meeting on your behalf. The AI will reference this in future calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-3">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Discovery call with Acme" />
            </div>
            <div>
              <Label>Starts at</Label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>Ends at</Label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={submit} disabled={create.isPending}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming events</CardTitle>
        </CardHeader>
        <CardContent>
          {(!events || events.length === 0) && (
            <p className="text-sm text-muted-foreground">No upcoming events. Connect Google Calendar or Outlook to pull in your existing schedule.</p>
          )}
          <div className="space-y-2">
            {(events ?? []).map((e: any) => (
              <div key={e.id} className="flex items-start justify-between p-3 border rounded-md">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.title}</span>
                    {e.id < 0 && <Badge variant="outline">external</Badge>}
                    {e.source === "ai_assistant" && <Badge>AI</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(e.startsAt).toLocaleString()} — {new Date(e.endsAt).toLocaleString()} {e.timeZone}
                  </div>
                  {e.description && <p className="text-sm mt-1">{e.description}</p>}
                </div>
                {e.id > 0 && e.status !== "cancelled" && (
                  <Button variant="ghost" size="icon" onClick={() => cancel.mutate({ id: e.id })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Email tab ──────────────────────────────────────────────────────────
function EmailTab() {
  const utils = trpc.useUtils();
  const { data: inbox } = trpc.assistant.listInbox.useQuery({ unreadOnly: false });
  const { data: drafts } = trpc.assistant.listDrafts.useQuery({});
  const approve = trpc.assistant.approveDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft approved & sent");
      void utils.assistant.listDrafts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = trpc.assistant.rejectDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft rejected");
      void utils.assistant.listDrafts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inbox</CardTitle>
          <CardDescription>
            {inbox?.connected
              ? `Showing ${inbox.emails.length} recent messages.`
              : "Connect Gmail or Outlook in the Integrations tab to see your inbox."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inbox?.connected && inbox.emails.length === 0 && (
            <p className="text-sm text-muted-foreground">No messages.</p>
          )}
          <div className="space-y-2">
            {(inbox?.emails ?? []).map((m: any) => (
              <div key={m.externalId} className="p-3 border rounded-md">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.subject}</span>
                      {m.isUnread && <Badge>new</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">From {m.from} · {new Date(m.receivedAt).toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI drafts (pending review)</CardTitle>
          <CardDescription>
            The AI drafts replies on your behalf. Review, edit, approve, or reject each one.
            The AI never auto-sends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(!drafts || drafts.length === 0) && (
            <p className="text-sm text-muted-foreground">No drafts. The AI will create drafts as it processes emails and calls.</p>
          )}
          <div className="space-y-3">
            {(drafts ?? []).map((d: any) => (
              <div key={d.id} className="p-4 border rounded-md space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{d.subject}</p>
                    <p className="text-xs text-muted-foreground">To: {d.toAddr}</p>
                  </div>
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                {d.aiReasoning && (
                  <p className="text-xs italic text-muted-foreground">AI reasoning: {d.aiReasoning}</p>
                )}
                <Textarea value={d.body} readOnly className="text-sm" rows={4} />
                {d.status === "draft" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => approve.mutate({ id: d.id })}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      Approve & send
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reject.mutate({ id: d.id })}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Calls tab ──────────────────────────────────────────────────────────
function CallsTab() {
  const utils = trpc.useUtils();
  const { data: tasks } = trpc.assistant.listCallTasks.useQuery({});
  const place = trpc.assistant.placeCallTask.useMutation({
    onSuccess: (r) => {
      toast.success(`Call placed: ${r.callSid}`);
      void utils.assistant.listCallTasks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.assistant.cancelCallTask.useMutation({
    onSuccess: () => {
      void utils.assistant.listCallTasks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.assistant.createCallTask.useMutation({
    onSuccess: () => {
      toast.success("Task created");
      void utils.assistant.listCallTasks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [toNumber, setToNumber] = useState("");
  const [taskBrief, setTaskBrief] = useState("");

  const submit = () => {
    if (!toNumber || !taskBrief) {
      toast.error("Phone and brief are required.");
      return;
    }
    create.mutate({ toNumber, taskBrief });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New call task</CardTitle>
          <CardDescription>
            "Call John at Acme about the contract" — the AI places the call on your behalf,
            delivers the message, takes a transcript, and posts the summary here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>To</Label>
              <Input value={toNumber} onChange={(e) => setToNumber(e.target.value)} placeholder="+17543529826" />
            </div>
            <div className="md:col-span-2">
              <Label>Brief</Label>
              <Input value={taskBrief} onChange={(e) => setTaskBrief(e.target.value)} placeholder="Tell John the contract is ready for review" />
            </div>
          </div>
          <Button onClick={submit} disabled={create.isPending}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create task
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Call tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {(!tasks || tasks.length === 0) && (
            <p className="text-sm text-muted-foreground">No call tasks yet.</p>
          )}
          <div className="space-y-2">
            {(tasks ?? []).map((t: any) => (
              <div key={t.id} className="flex items-start justify-between p-3 border rounded-md">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{t.toNumber}</span>
                    <Badge variant="outline">{t.status}</Badge>
                  </div>
                  <p className="text-sm mt-1">{t.taskBrief}</p>
                  {t.transcriptSummary && (
                    <p className="text-xs text-muted-foreground mt-1">Summary: {t.transcriptSummary}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  {t.status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => place.mutate({ id: t.id })}>
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        Place now
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ id: t.id })}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Reminders tab ──────────────────────────────────────────────────────
function RemindersTab() {
  const utils = trpc.useUtils();
  const { data: reminders } = trpc.assistant.listReminders.useQuery({});
  const create = trpc.assistant.createReminder.useMutation({
    onSuccess: () => {
      toast.success("Reminder set");
      void utils.assistant.listReminders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.assistant.cancelReminder.useMutation({
    onSuccess: () => {
      void utils.assistant.listReminders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [message, setMessage] = useState("");
  const [fireAt, setFireAt] = useState("");
  const [channel, setChannel] = useState<"sms" | "call" | "email">("sms");
  const [destination, setDestination] = useState("");

  const submit = () => {
    if (!message || !fireAt || !destination) {
      toast.error("Message, time, and destination are required.");
      return;
    }
    create.mutate({
      message,
      fireAt: new Date(fireAt).toISOString(),
      channel,
      destination,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New reminder</CardTitle>
          <CardDescription>
            "Remind me to call Mom tomorrow at 6pm" — fires via SMS, call, or email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label>Message</Label>
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Call Mom" />
            </div>
            <div>
              <Label>Fire at</Label>
              <Input type="datetime-local" value={fireAt} onChange={(e) => setFireAt(e.target.value)} />
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Destination</Label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="+17543529826 or you@email.com" />
            </div>
            <div className="flex items-end">
              <Button onClick={submit} disabled={create.isPending}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Set
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminders</CardTitle>
        </CardHeader>
        <CardContent>
          {(!reminders || reminders.length === 0) && (
            <p className="text-sm text-muted-foreground">No reminders. The AI can also set reminders on your behalf during calls.</p>
          )}
          <div className="space-y-2">
            {(reminders ?? []).map((r: any) => (
              <div key={r.id} className="flex items-start justify-between p-3 border rounded-md">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{r.message}</span>
                    <Badge variant="outline">{r.channel}</Badge>
                    <Badge variant="secondary">{r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Fires {new Date(r.fireAt).toLocaleString()} → {r.destination}
                  </p>
                </div>
                {r.status === "active" && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ id: r.id })}>
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
