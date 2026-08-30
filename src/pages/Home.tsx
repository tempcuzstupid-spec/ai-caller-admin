import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOGIN_PATH } from "@/const";
import {
  Phone, PhoneCall, PhoneIncoming, MessageSquare, Mail, Bot,
  ShieldCheck, Zap, ArrowRight, CalendarClock,
} from "lucide-react";

const features = [
  { icon: PhoneIncoming, title: "Inbound Support", desc: "AI answers your business line 24/7, resolves questions, and transfers to a human on request." },
  { icon: PhoneCall, title: "Outbound Sales", desc: "AI qualifies leads, recommends one option, texts the details, and hands warm leads to your closer." },
  { icon: CalendarClock, title: "Appointment Reminders", desc: "Automated confirmation, rescheduling, and cancellation calls." },
  { icon: Bot, title: "Personal Assistant", desc: "Calls restaurants, salons, and services on your behalf — with full AI disclosure." },
  { icon: MessageSquare, title: "WhatsApp + SMS", desc: "Your AI can text links, confirmations, and follow-ups through your Twilio number." },
  { icon: Mail, title: "Email", desc: "Send transactional email through your own SMTP — receipts, summaries, follow-ups." },
];

export default function Home() {
  const { user, isLoading } = useAuth();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Phone className="h-5 w-5 text-primary" /> VoiceReach AI
          </div>
          <Button onClick={() => (window.location.href = user ? "/dashboard" : LOGIN_PATH)}>
            {isLoading ? "…" : user ? "Open Dashboard" : "Sign in"} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6">
        <section className="py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm text-muted-foreground mb-6">
            <ShieldCheck className="h-4 w-4" /> Bring your own Twilio &amp; SMTP — your keys, your calls
          </div>
          <h1 className="text-5xl font-bold tracking-tight leading-tight">
            Your AI phone agent,
            <br />
            programmed by you.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Build voice agents that answer and place real phone calls, say exactly what you want them
            to say, and follow up by WhatsApp, SMS, and email. Five categories, full prompt control,
            real telephony — no code required.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button size="lg" onClick={() => (window.location.href = user ? "/dashboard" : LOGIN_PATH)}>
              <Zap className="mr-2 h-4 w-4" /> Start building
            </Button>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-4 pb-24">
          {features.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <f.icon className="h-6 w-6 text-primary mb-2" />
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{f.desc}</CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
