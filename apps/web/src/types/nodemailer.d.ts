// Minimal typings for the parts of nodemailer used by the shutdown notice
// sender (avoids @types/nodemailer, which pulls in the AWS SES SDK).
declare module "nodemailer" {
  interface SendMailOptions {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    headers?: Record<string, string>;
  }
  interface SentMessageInfo {
    messageId: string;
    accepted: string[];
    rejected: string[];
  }
  interface Transporter {
    sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
    verify(): Promise<true>;
  }
  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }
  const nodemailer: {
    createTransport(options: TransportOptions): Transporter;
  };
  export default nodemailer;
}
