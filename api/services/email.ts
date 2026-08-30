import nodemailer from "nodemailer";

export type SmtpCreds = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export async function sendEmail(
  c: SmtpCreds,
  opts: { to: string; subject: string; body: string },
) {
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
  });
  const info = await transporter.sendMail({
    from: c.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
  });
  return { messageId: info.messageId };
}

export async function testSmtp(c: SmtpCreds) {
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 8000,
  });
  await transporter.verify();
  return { ok: true };
}
