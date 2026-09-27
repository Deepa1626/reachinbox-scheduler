import nodemailer from "nodemailer";

export interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
}

// Creates a fresh disposable Ethereal test inbox. Used when a sender is
// first created and no explicit SMTP_USER/PASS is configured in .env.
export async function createEtherealAccount(): Promise<EtherealAccount> {
  const testAccount = await nodemailer.createTestAccount();
  console.log(`[ethereal] created test account: ${testAccount.user}`);
  return {
    user: testAccount.user,
    pass: testAccount.pass,
    smtp: { host: testAccount.smtp.host, port: testAccount.smtp.port, secure: testAccount.smtp.secure },
  };
}

export function buildTransport(sender: {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
}) {
  return nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    secure: sender.smtp_port === 465,
    auth: { user: sender.smtp_user, pass: sender.smtp_pass },
  });
}

export async function sendEmail(
  sender: { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string },
  opts: { to: string; subject: string; html: string }
) {
  const transporter = buildTransport(sender);
  const info = await transporter.sendMail({
    from: sender.smtp_user,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info) || null, // Ethereal preview link
  };
}
