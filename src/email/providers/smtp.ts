import net from 'node:net';
import tls from 'node:tls';
import type { EmailProvider, EmailMessage } from '../types.js';

interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  rejectUnauthorized?: boolean;
  auth: { user: string; pass: string };
}

function readLine(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => {
      socket.removeListener('data', onData);
      reject(new Error('SMTP timeout'));
    }, 30000);
    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      const lines = data.split('\r\n');
      // Find the last complete line (ignore trailing empty from split)
      const complete = lines.slice(0, -1);
      if (complete.length > 0) {
        const lastLine = complete[complete.length - 1];
        // Final SMTP response line has a space after the 3-digit code, not '-'
        if (/^\d{3} /.test(lastLine) || !/^\d{3}[-]/.test(lastLine)) {
          socket.removeListener('data', onData);
          clearTimeout(timer);
          resolve(complete.join('\r\n'));
        }
      }
    };
    socket.on('data', onData);
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function writeLine(socket: net.Socket | tls.TLSSocket, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.write(line + '\r\n', () => {
      readLine(socket).then(resolve).catch(reject);
    });
  });
}

export function createSmtpProvider(config: SmtpConfig): EmailProvider {
  return {
    async send(message: EmailMessage & { from: string }) {
      const fromEmail = message.from.replace(/.*<(.+)>/, '$1').trim() || message.from;

      let socket: net.Socket | tls.TLSSocket;

      if (config.secure) {
        socket = tls.connect({ host: config.host, port: config.port, rejectUnauthorized: config.rejectUnauthorized !== false });
      } else {
        socket = net.createConnection({ host: config.host, port: config.port });
      }

      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });

      try {
        await readLine(socket); // greeting

        const ehloRes = await writeLine(socket, `EHLO localhost`);

        // STARTTLS if not already secure
        if (!config.secure && ehloRes.includes('STARTTLS')) {
          await writeLine(socket, 'STARTTLS');
          socket = tls.connect({ socket, host: config.host, rejectUnauthorized: config.rejectUnauthorized !== false });
          await new Promise<void>((resolve) => (socket as tls.TLSSocket).once('secureConnect', resolve));
          await writeLine(socket, 'EHLO localhost');
        }

        // AUTH LOGIN
        const authRes = await writeLine(socket, 'AUTH LOGIN');
        if (authRes.startsWith('334')) {
          const userRes = await writeLine(socket, Buffer.from(config.auth.user).toString('base64'));
          if (userRes.startsWith('334')) {
            const passRes = await writeLine(socket, Buffer.from(config.auth.pass).toString('base64'));
            if (!passRes.startsWith('235')) throw new Error(`SMTP auth failed: ${passRes}`);
          }
        }

        const mailRes = await writeLine(socket, `MAIL FROM:<${fromEmail}>`);
        if (!mailRes.startsWith('250')) throw new Error(`MAIL FROM failed: ${mailRes}`);

        const rcptRes = await writeLine(socket, `RCPT TO:<${message.to}>`);
        if (!rcptRes.startsWith('250')) throw new Error(`RCPT TO failed: ${rcptRes}`);

        const dataRes = await writeLine(socket, 'DATA');
        if (!dataRes.startsWith('354')) throw new Error(`DATA failed: ${dataRes}`);

        const boundary = `----=_Part_${Date.now()}`;
        const textBody = (message.text || message.html.replace(/<[^>]+>/g, '')).replace(/^\./gm, '..');
        const htmlBody = message.html.replace(/^\./gm, '..');
        const emailData = [
          `From: ${message.from}`,
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          `Date: ${new Date().toUTCString()}`,
          '',
          `--${boundary}`,
          `Content-Type: text/plain; charset=utf-8`,
          '',
          textBody,
          '',
          `--${boundary}`,
          `Content-Type: text/html; charset=utf-8`,
          '',
          htmlBody,
          '',
          `--${boundary}--`,
          '.',
        ].join('\r\n');

        const sendRes = await writeLine(socket, emailData);
        if (!sendRes.startsWith('250')) throw new Error(`Send failed: ${sendRes}`);

        await writeLine(socket, 'QUIT');
      } finally {
        socket.destroy();
      }
    },
  };
}
