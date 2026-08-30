import { useEffect, useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Settings() {
  const utils = trpc.useUtils();
  const creds = trpc.credentials.get.useQuery();
  const save = trpc.credentials.save.useMutation({
    onSuccess: () => { utils.credentials.get.invalidate(); toast.success("Settings saved"); },
    onError: (e) => toast.error(e.message),
  });
  const testTwilio = trpc.credentials.testTwilio.useMutation({
    onSuccess: (r) => toast.success(`Twilio OK — ${r.friendlyName} (${r.status})`),
    onError: (e) => toast.error(e.message),
  });
  const testSmtp = trpc.credentials.testSmtp.useMutation({
    onSuccess: () => toast.success("SMTP connection verified"),
    onError: (e) => toast.error(e.message),
  });

  const [f, setF] = useState({
    twilioAccountSid: "", twilioAuthToken: "", twilioPhoneNumber: "", twilioWhatsappNumber: "",
    smtpHost: "", smtpPort: "", smtpUser: "", smtpPass: "", smtpFrom: "",
    wsGatewayUrl: "", conversationWsToken: "",
  });

  useEffect(() => {
    const d = creds.data;
    if (d) {
      setF((p) => ({
        ...p,
        twilioAccountSid: d.twilioAccountSid ?? "",
        twilioPhoneNumber: d.twilioPhoneNumber ?? "",
        twilioWhatsappNumber: d.twilioWhatsappNumber ?? "",
        smtpHost: d.smtpHost ?? "",
        smtpPort: d.smtpPort ? String(d.smtpPort) : "",
        smtpUser: d.smtpUser ?? "",
        smtpFrom: d.smtpFrom ?? "",
        wsGatewayUrl: d.wsGatewayUrl ?? "",
        // secrets (tokens/passwords) intentionally not prefilled
      }));
    }
  }, [creds.data]);

  const submit = () => {
    save.mutate({
      ...f,
      smtpPort: f.smtpPort ? Number(f.smtpPort) : null,
    });
  };

  return (
    <AuthLayout>
      <div className="p-6 max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Secrets (auth token, SMTP password, gateway token) are write-only — leave blank to keep the saved value.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Twilio — calls, SMS, WhatsApp</CardTitle>
            <CardDescription>From your Twilio Console. WhatsApp needs an approved sender (or the sandbox number).</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div><Label>Account SID</Label><Input value={f.twilioAccountSid} onChange={(e) => setF({ ...f, twilioAccountSid: e.target.value })} placeholder="AC…" /></div>
            <div><Label>Auth Token {creds.data?.hasTwilioAuthToken && "(saved)"}</Label><Input type="password" value={f.twilioAuthToken} onChange={(e) => setF({ ...f, twilioAuthToken: e.target.value })} placeholder={creds.data?.hasTwilioAuthToken ? "••••••••" : ""} /></div>
            <div><Label>Phone number (voice + SMS)</Label><Input value={f.twilioPhoneNumber} onChange={(e) => setF({ ...f, twilioPhoneNumber: e.target.value })} placeholder="+15551234567" /></div>
            <div><Label>WhatsApp sender (optional)</Label><Input value={f.twilioWhatsappNumber} onChange={(e) => setF({ ...f, twilioWhatsappNumber: e.target.value })} placeholder="+14155238886" /></div>
            <Button variant="outline" onClick={() => testTwilio.mutate()} disabled={testTwilio.isPending}>
              {testTwilio.isPending ? "Testing…" : "Test Twilio connection"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SMTP — email sending</CardTitle>
            <CardDescription>Any SMTP provider: Gmail app password, SendGrid, SES, your own server.</CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div><Label>Host</Label><Input value={f.smtpHost} onChange={(e) => setF({ ...f, smtpHost: e.target.value })} placeholder="smtp.gmail.com" /></div>
            <div><Label>Port</Label><Input value={f.smtpPort} onChange={(e) => setF({ ...f, smtpPort: e.target.value })} placeholder="465 or 587" /></div>
            <div><Label>Username</Label><Input value={f.smtpUser} onChange={(e) => setF({ ...f, smtpUser: e.target.value })} /></div>
            <div><Label>Password {creds.data?.hasSmtpPass && "(saved)"}</Label><Input type="password" value={f.smtpPass} onChange={(e) => setF({ ...f, smtpPass: e.target.value })} placeholder={creds.data?.hasSmtpPass ? "••••••••" : ""} /></div>
            <div><Label>From address</Label><Input value={f.smtpFrom} onChange={(e) => setF({ ...f, smtpFrom: e.target.value })} placeholder="you@yourcompany.com" /></div>
            <Button variant="outline" onClick={() => testSmtp.mutate()} disabled={testSmtp.isPending}>
              {testSmtp.isPending ? "Testing…" : "Test SMTP connection"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voice gateway (ConversationRelay)</CardTitle>
            <CardDescription>
              The WebSocket service that runs the live AI conversation loop (your VPS or hosted gateway).
              Calls connect here via Twilio ConversationRelay.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div><Label>Gateway URL</Label><Input value={f.wsGatewayUrl} onChange={(e) => setF({ ...f, wsGatewayUrl: e.target.value })} placeholder="wss://ws.example.com/ws/conversation" /></div>
            <div><Label>Gateway token {creds.data?.hasWsToken && "(saved)"}</Label><Input type="password" value={f.conversationWsToken} onChange={(e) => setF({ ...f, conversationWsToken: e.target.value })} placeholder={creds.data?.hasWsToken ? "••••••••" : "shared secret"} /></div>
          </CardContent>
        </Card>

        <Button size="lg" onClick={submit} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </AuthLayout>
  );
}
