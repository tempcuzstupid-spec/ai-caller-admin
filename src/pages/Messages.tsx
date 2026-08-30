import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, Mail, Smartphone } from "lucide-react";
import { toast } from "sonner";

type Channel = "whatsapp" | "email" | "sms";

export default function Messages() {
  const utils = trpc.useUtils();
  const list = trpc.messages.list.useQuery();
  const contacts = trpc.contacts.list.useQuery();
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const send = trpc.messages.send.useMutation({
    onSuccess: () => {
      toast.success("Message sent");
      utils.messages.list.invalidate();
      setBody("");
    },
    onError: (e) => toast.error(e.message),
  });

  const icons = { whatsapp: MessageSquare, email: Mail, sms: Smartphone } as const;

  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Messaging</h1>

        <Card>
          <CardHeader><CardTitle>Send a message</CardTitle></CardHeader>
          <CardContent>
            <Tabs value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <TabsList>
                <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                <TabsTrigger value="sms">SMS</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
              </TabsList>
              <div className="mt-4 space-y-3">
                <div>
                  <Label>{channel === "email" ? "To (email)" : "To (E.164 phone)"}</Label>
                  <Input value={to} onChange={(e) => setTo(e.target.value)}
                    placeholder={channel === "email" ? "jane@example.com" : "+15551234567"}
                    list="contacts-msg" />
                  <datalist id="contacts-msg">
                    {contacts.data?.map((c) => (
                      <option key={c.id} value={channel === "email" ? c.email ?? "" : c.phone}>{c.name}</option>
                    ))}
                  </datalist>
                </div>
                {channel === "email" && (
                  <div>
                    <Label>Subject</Label>
                    <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label>Message</Label>
                  <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
                </div>
                <Button disabled={!to || !body || send.isPending}
                  onClick={() => send.mutate({ channel, to, subject: subject || undefined, body })}>
                  {send.isPending ? "Sending…" : "Send"}
                </Button>
              </div>
              <TabsContent value={channel} />
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {list.data?.map((m) => {
                const Icon = icons[m.channel];
                return (
                  <div key={m.id} className="flex items-start justify-between gap-3 border-b last:border-0 pb-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-mono">{m.toAddr}</div>
                        <div className="text-muted-foreground line-clamp-1">{m.subject ? `${m.subject} — ` : ""}{m.body}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground text-xs">{new Date(m.createdAt).toLocaleString()}</span>
                      <Badge variant={m.status === "sent" ? "default" : m.status === "failed" ? "destructive" : "secondary"}>
                        {m.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
              {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  );
}
