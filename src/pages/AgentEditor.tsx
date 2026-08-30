import { useEffect, useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

export default function AgentEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const templates = trpc.agents.templates.useQuery();
  const existing = trpc.agents.get.useQuery({ id: Number(id) }, { enabled: !isNew });

  const [form, setForm] = useState({
    name: "", category: "custom", direction: "both",
    systemPrompt: "", openingLine: "", voiceId: "TxGEqnHWrfWFTfGW9XjX",
    model: "gpt-4o-mini", active: true,
  });

  useEffect(() => {
    if (existing.data) {
      const a = existing.data;
      setForm({
        name: a.name, category: a.category, direction: a.direction,
        systemPrompt: a.systemPrompt, openingLine: a.openingLine ?? "",
        voiceId: a.voiceId, model: a.model, active: a.active,
      });
    }
  }, [existing.data]);

  const applyTemplate = (catId: string) => {
    const t = templates.data?.find((x) => x.id === catId);
    if (!t) return;
    setForm((f) => ({
      ...f,
      category: catId,
      direction: t.direction,
      systemPrompt: t.defaultPrompt.replaceAll("{name}", f.name || "your agent"),
      openingLine: t.defaultOpening.replaceAll("{name}", f.name || "your agent"),
    }));
  };

  const save = trpc.agents.create.useMutation({
    onSuccess: (r) => { utils.agents.list.invalidate(); toast.success("Agent created"); navigate(`/agents/${r.id}`); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.agents.update.useMutation({
    onSuccess: () => { utils.agents.list.invalidate(); toast.success("Agent saved"); },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) {
      toast.error("Name and system prompt are required");
      return;
    }
    const data = { ...form, category: form.category as any, direction: form.direction as any, openingLine: form.openingLine || null };
    if (isNew) save.mutate(data);
    else update.mutate({ id: Number(id), data });
  };

  return (
    <AuthLayout>
      <div className="p-6 max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">{isNew ? "New agent" : `Edit: ${form.name}`}</h1>

        <Card>
          <CardHeader><CardTitle>Identity &amp; category</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Agent name (used as the AI's name)</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Marcus" />
            </div>
            <div>
              <Label>Category — loads a proven template you can fully rewrite</Label>
              <Select value={form.category} onValueChange={applyTemplate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {templates.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label} — {t.description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Direction</Label>
              <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Inbound (answers calls)</SelectItem>
                  <SelectItem value="outbound">Outbound (places calls)</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label>Active</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What the AI says — full control</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Opening line (spoken first on outbound calls)</Label>
              <Textarea rows={2} value={form.openingLine}
                onChange={(e) => setForm({ ...form, openingLine: e.target.value })}
                placeholder="Hi, this is Marcus calling from…" />
            </div>
            <div>
              <Label>System prompt — the AI's complete instructions</Label>
              <Textarea rows={14} value={form.systemPrompt} className="font-mono text-sm"
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                placeholder="You are Marcus, calling on behalf of…" />
              <p className="text-xs text-muted-foreground mt-1">
                This is exactly what the model is told. Write rules, scripts, product info, compliance lines — anything.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Voice &amp; model</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <Label>Voice (ElevenLabs via Twilio)</Label>
              <Select value={form.voiceId} onValueChange={(v) => setForm({ ...form, voiceId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TxGEqnHWrfWFTfGW9XjX">Josh — deep male, warm</SelectItem>
                  <SelectItem value="EXAVITQu4vr4xnSDxMaL">Sarah — calm female</SelectItem>
                  <SelectItem value="21m00Tcm4TlvDq8ikWAM">Rachel — conversational female</SelectItem>
                  <SelectItem value="ErXwobaYiN019PkySvjV">Antoni — friendly male</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Model</Label>
              <Select value={form.model} onValueChange={(v) => setForm({ ...form, model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">gpt-4o-mini (fast, cheap)</SelectItem>
                  <SelectItem value="gpt-4o">gpt-4o (smartest)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Button onClick={submit} disabled={save.isPending || update.isPending} size="lg">
          {save.isPending || update.isPending ? "Saving…" : isNew ? "Create agent" : "Save changes"}
        </Button>
      </div>
    </AuthLayout>
  );
}
