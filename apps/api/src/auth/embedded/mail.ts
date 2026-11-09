/**
 * Account mail (invitations, password resets, address verification). Sent
 * over the SMTP server the operator names; without one nothing is sent, and
 * the features that depend on mail are off or fall back to a link the
 * operator hands over (`account invite` prints it).
 */
import { createTransport } from 'nodemailer';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

export function createMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}
