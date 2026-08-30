import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Contacts() {
  const utils = trpc.useUtils();
  const list = trpc.contacts.list.useQuery();
  const [form, setForm] = useState({ name: "", phone: "", email: "", tags: "" });

  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => { utils.contacts.list.invalidate(); setForm({ name: "", phone: "", email: "", tags: "" }); toast.success("Contact saved"); },
    onError: (e) => toast.error(e.message),
  });
  const setDnc = trpc.contacts.setDnc.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <AuthLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Contacts</h1>

        <Card>
          <CardHeader><CardTitle>Add contact</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-5 gap-3 items-end">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Phone (E.164)</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+15551234567" /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Tags</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="lead, vip" /></div>
            <Button disabled={!form.name || !form.phone || upsert.isPending}
              onClick={() => upsert.mutate({ ...form, email: form.email || null, tags: form.tags || null })}>
              <UserPlus className="mr-2 h-4 w-4" /> Add
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All contacts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {list.data?.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 border-b last:border-0 pb-2 text-sm">
                  <div>
                    <div className="font-medium">{c.name} {c.tags && <span className="text-xs text-muted-foreground">({c.tags})</span>}</div>
                    <div className="font-mono text-muted-foreground">{c.phone} {c.email && `· ${c.email}`}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.dnc && <Badge variant="destructive">DNC</Badge>}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      Do not call
                      <Switch checked={c.dnc} onCheckedChange={(v) => setDnc.mutate({ id: c.id, dnc: v })} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate({ id: c.id })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  );
}
