import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

const CATEGORY_LABELS: Record<string, string> = {
  inbound_support: "Inbound Support",
  outbound_sales: "Outbound Sales",
  appointment_reminder: "Reminders",
  personal_assistant: "Personal Assistant",
  custom: "Custom",
};

export default function Agents() {
  const utils = trpc.useUtils();
  const list = trpc.agents.list.useQuery();
  const remove = trpc.agents.remove.useMutation({
    onSuccess: () => { utils.agents.list.invalidate(); toast.success("Agent deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Agents</h1>
          <Button asChild><Link to="/agents/new"><Plus className="mr-2 h-4 w-4" /> New agent</Link></Button>
        </div>

        {list.data?.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            No agents yet. Create one from a category template — you can rewrite everything it says.
          </CardContent></Card>
        )}

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.data?.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{a.name}</CardTitle>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="secondary">{CATEGORY_LABELS[a.category]}</Badge>
                    <Badge variant="outline">{a.direction}</Badge>
                    {!a.active && <Badge variant="destructive">paused</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{a.systemPrompt}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/agents/${a.id}`}><Pencil className="mr-1 h-3 w-3" /> Edit</Link>
                  </Button>
                  {confirmId === a.id ? (
                    <>
                      <Button size="sm" variant="destructive" onClick={() => remove.mutate({ id: a.id })}>Confirm</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(a.id)}>
                      <Trash2 className="mr-1 h-3 w-3" /> Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
