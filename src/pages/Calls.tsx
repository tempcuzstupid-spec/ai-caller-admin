import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhoneOutgoing, ScrollText } from "lucide-react";
import { toast } from "sonner";

export default function Calls() {
  const utils = trpc.useUtils();
  const list = trpc.calls.list.useQuery();
  const agents = trpc.agents.list.useQuery();
  const contacts = trpc.contacts.list.useQuery();
  const [agentId, setAgentId] = useState<string>("");
  const [to, setTo] = useState("");
  const [leadName, setLeadName] = useState("");
  const [viewCallId, setViewCallId] = useState<number | null>(null);
  const transcript = trpc.calls.transcript.useQuery({ callId: viewCallId! }, { enabled: viewCallId !== null });

  const place = trpc.calls.placeCall.useMutation({
    onSuccess: (r) => {
      toast.success(`Call placed (${r.status})`);
      utils.calls.list.invalidate();
      setTo(""); setLeadName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const outboundAgents = agents.data?.filter((a) => a.direction !== "inbound") ?? [];

  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Calls</h1>

        <Card>
          <CardHeader><CardTitle>Place an outbound call</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Agent</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="Choose agent" /></SelectTrigger>
                <SelectContent>
                  {outboundAgents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To (E.164)</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+15551234567" list="contacts-list" />
              <datalist id="contacts-list">
                {contacts.data?.map((c) => <option key={c.id} value={c.phone}>{c.name}</option>)}
              </datalist>
            </div>
            <div>
              <Label>Lead name (optional)</Label>
              <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Jane" />
            </div>
            <Button
              disabled={!agentId || !to || place.isPending}
              onClick={() => place.mutate({ agentId: Number(agentId), to, leadName: leadName || undefined })}
            >
              <PhoneOutgoing className="mr-2 h-4 w-4" /> {place.isPending ? "Dialing…" : "Call now"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Call history</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {list.data?.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 border-b last:border-0 pb-2 text-sm">
                  <span className="font-mono">{c.direction === "outbound" ? c.toNumber : c.fromNumber}</span>
                  <span className="text-muted-foreground hidden md:inline">{new Date(c.createdAt).toLocaleString()}</span>
                  <span className="text-muted-foreground">{c.duration != null ? `${c.duration}s` : "—"}</span>
                  <Badge variant={c.status === "completed" ? "default" : "secondary"}>{c.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setViewCallId(c.id)}>
                    <ScrollText className="mr-1 h-3 w-3" /> Transcript
                  </Button>
                </div>
              ))}
              {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No calls yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={viewCallId !== null} onOpenChange={(o) => !o && setViewCallId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Transcript</DialogTitle></DialogHeader>
          {transcript.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {transcript.data?.lines.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No transcript recorded. Transcripts arrive from your voice gateway when the call ends.
            </p>
          )}
          <div className="space-y-3">
            {transcript.data?.lines.map((l) => (
              <div key={l.id} className={l.role === "assistant" ? "text-left" : "text-right"}>
                <div className={`inline-block rounded-lg px-3 py-2 text-sm max-w-[80%] ${l.role === "assistant" ? "bg-muted" : "bg-primary text-primary-foreground"}`}>
                  {l.content}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{l.role}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  );
}
