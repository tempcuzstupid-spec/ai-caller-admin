// Agent Editor — multi-tenant + multi-vertical aware.
//
// In the old model: pick a category template, edit prompt, save → flat Agent row.
// In the new model: pick a vertical (an industry template), save as an AgentConfig
// (a tenant's instantiation of that vertical with overrides). The vertical's
// defaultPrompt + defaultOpening are used unless the AgentConfig has overrides.

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
import { Badge } from "@/components/ui/badge";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

export default function AgentEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const templates = trpc.agents.templates.useQuery();
  const verticals = trpc.agents.listVerticals.useQuery();
  const existing = trpc.agents.get.useQuery(
    { id: Number(id) },
    { enabled: !isNew }
  );

  const [form, setForm] = useState({
    name: "",
    verticalId: 0,
    voiceId: "TxGEqnHWrfWFTfGW9XjX",
    model: "gpt-4o-mini",
    active: true,
    systemPromptOverride: "",
    openingLineOverride: "",
    handoffNumber: "",
    fromNumbers: "",
    complianceTier: "basic" as "basic" | "hipaa",
  });

  useEffect(() => {
    if (existing.data) {
      const a = existing.data;
      setForm({
        name: a.name,
        verticalId: a.verticalId,
        voiceId: a.voiceId,
        model: a.model,
        active: a.active,
        systemPromptOverride: a.systemPromptOverride ?? "",
        openingLineOverride: a.openingLineOverride ?? "",
        handoffNumber: a.handoffNumber ?? "",
        fromNumbers: a.fromNumbers ?? "",
        complianceTier: a.complianceTier,
      });
    }
  }, [existing.data]);

  const applyTemplate = (categoryId: string) => {
    const t = templates.data?.find((x) => x.id === categoryId);
    if (!t) return;
    // Find the matching vertical by category
    const matchingVertical = verticals.data?.find((v) => v.category === categoryId);
    if (matchingVertical) {
      setForm((f) => ({
        ...f,
        verticalId: matchingVertical.id,
        // Pre-fill overrides with the template's defaults (user can edit before save)
        systemPromptOverride: t.defaultPrompt.replaceAll("{name}", f.name || "your agent"),
        openingLineOverride: t.defaultOpening.replaceAll("{name}", f.name || "your agent"),
        complianceTier: t.defaultComplianceTier,
      }));
    } else {
      toast.error(`No vertical found for category "${categoryId}". Seed the database first.`);
    }
  };

  const save = trpc.agents.create.useMutation({
    onSuccess: (r) => {
      utils.agents.list.invalidate();
      toast.success("Agent created");
      navigate(`/agents/${r.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.agents.update.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.success("Agent saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (isNew && !form.verticalId) {
      toast.error("Pick a vertical template first");
      return;
    }
    const data: any = {
      name: form.name,
      voiceId: form.voiceId,
      model: form.model,
      active: form.active,
      systemPromptOverride: form.systemPromptOverride || null,
      openingLineOverride: form.openingLineOverride || null,
      handoffNumber: form.handoffNumber || null,
      fromNumbers: form.fromNumbers || null,
      complianceTier: form.complianceTier,
    };
    if (isNew) {
      save.mutate({ ...data, verticalId: form.verticalId });
    } else {
      update.mutate({ id: Number(id), ...data });
    }
  };

  const selectedVertical = verticals.data?.find((v) => v.id === form.verticalId);

  return (
    <AuthLayout>
      <div className="p-6 max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">{isNew ? "New agent" : `Edit: ${form.name}`}</h1>

        <Card>
          <CardHeader>
            <CardTitle>Identity &amp; vertical</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Agent name (used as the AI's name in the prompt)</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Marcus — Peptide Sales"
              />
            </div>
            <div>
              <Label>Vertical — pick an industry template to start from</Label>
              <Select
                value={selectedVertical?.category ?? ""}
                onValueChange={applyTemplate}
                disabled={!isNew}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a vertical..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label} — {t.direction}
                      {t.defaultComplianceTier === "hipaa" ? " · HIPAA" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVertical && (
                <p className="text-xs text-muted-foreground mt-1">{selectedVertical.description}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
              <Label>Active</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              What the AI says
              {selectedVertical && (
                <Badge variant="outline" className="ml-2 text-xs">
                  inherits from {selectedVertical.name}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Opening line (overrides vertical default)</Label>
              <Textarea
                rows={2}
                value={form.openingLineOverride}
                onChange={(e) => setForm({ ...form, openingLineOverride: e.target.value })}
                placeholder="Hi, this is Marcus calling from…"
              />
            </div>
            <div>
              <Label>System prompt (overrides vertical default)</Label>
              <Textarea
                rows={14}
                value={form.systemPromptOverride}
                className="font-mono text-sm"
                onChange={(e) => setForm({ ...form, systemPromptOverride: e.target.value })}
                placeholder="You are Marcus, calling on behalf of…"
              />
              <p className="text-xs text-muted-foreground mt-1">
                This is exactly what the model is told. Leave blank to use the vertical's
                default prompt.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voice &amp; model</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <Label>Voice (ElevenLabs via Twilio)</Label>
              <Select value={form.voiceId} onValueChange={(v) => setForm({ ...form, voiceId: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">gpt-4o-mini (fast, cheap)</SelectItem>
                  <SelectItem value="gpt-4o">gpt-4o (smartest)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phone numbers &amp; handoff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>From numbers (CSV — Twilio numbers this agent picks up / calls from)</Label>
              <Input
                value={form.fromNumbers}
                onChange={(e) => setForm({ ...form, fromNumbers: e.target.value })}
                placeholder="+17543529826,+17542193360"
              />
            </div>
            <div>
              <Label>Handoff number (warm-transfer destination — leave blank to disable)</Label>
              <Input
                value={form.handoffNumber}
                onChange={(e) => setForm({ ...form, handoffNumber: e.target.value })}
                placeholder="+17543529826"
              />
            </div>
            <div>
              <Label>Compliance tier</Label>
              <Select
                value={form.complianceTier}
                onValueChange={(v) => setForm({ ...form, complianceTier: v as "basic" | "hipaa" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic (row-level tenant isolation)</SelectItem>
                  <SelectItem value="hipaa">HIPAA (per-tenant encryption + audit)</SelectItem>
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
