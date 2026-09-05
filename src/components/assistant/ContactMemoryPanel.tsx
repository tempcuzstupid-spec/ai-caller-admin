// Contact memory panel — shows the AI's persistent notes about a person.
// Opened from the Contacts page. Lets the owner add manual notes and
// see AI-summarized notes from past calls.

import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Brain, Plus, Trash2, Heart, User, Bookmark } from "lucide-react";
import { toast } from "sonner";

type Props = {
  contactId: number;
  contactName: string;
};

const CATEGORIES = [
  { value: "preference", label: "Preference", icon: Bookmark },
  { value: "family", label: "Family", icon: User },
  { value: "health_context", label: "Health context", icon: Heart },
  { value: "general", label: "General", icon: Brain },
  { value: "other", label: "Other", icon: Bookmark },
] as const;

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  call: { label: "From a call", color: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300" },
  manual: { label: "You wrote this", color: "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300" },
  ai_summary: { label: "AI summary", color: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
};

export function ContactMemoryPanel({ contactId, contactName }: Props) {
  const utils = trpc.useUtils();
  const { data: notes, isLoading } = trpc.assistant.listContactNotes.useQuery({ contactId });
  const append = trpc.assistant.appendContactNote.useMutation({
    onSuccess: () => {
      toast.success("Note saved");
      setNote("");
      void utils.assistant.listContactNotes.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.assistant.deleteContactNote.useMutation({
    onSuccess: () => {
      void utils.assistant.listContactNotes.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [note, setNote] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]["value"]>("general");

  const submit = () => {
    if (!note.trim()) {
      toast.error("Note is empty.");
      return;
    }
    append.mutate({ contactId, note, category, source: "manual" });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI memory: {contactName}
            </CardTitle>
            <CardDescription>
              Notes the AI assistant has remembered about this person.
              Read on every interaction, appended after each call.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={category} onValueChange={(v) => setCategory(v as any)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Prefers morning calls. Has two kids — Sam (8) and Lila (5). Allergic to dairy."
            rows={3}
          />
          <Button onClick={submit} disabled={append.isPending || !note.trim()} size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Save note
          </Button>
        </div>

        <div className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!isLoading && (!notes || notes.length === 0) && (
            <p className="text-sm text-muted-foreground">
              No notes yet. The AI will add notes here as it talks to {contactName}.
            </p>
          )}
          {(notes ?? []).map((n: any) => {
            const cat = CATEGORIES.find((c) => c.value === n.category);
            const Icon = cat?.icon ?? Brain;
            const src = SOURCE_LABELS[n.source] ?? SOURCE_LABELS.manual!;
            return (
              <div key={n.id} className="border rounded-md p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{cat?.label ?? n.category}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${src.color}`}>
                      {src.label}
                    </span>
                    {n.phiClassification === "phi" && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700">
                        PHI
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => remove.mutate({ id: n.id })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-sm whitespace-pre-wrap">{n.note}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
