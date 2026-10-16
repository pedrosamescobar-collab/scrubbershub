// Delivery channels for notifications. Core business logic never calls these
// directly — it only writes rows to `public.notifications`. The dispatcher
// function reads pending rows and fans them out here.
//
// Each channel is enabled only when its environment variables are present.

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  link?: string | null;
  orgName: string;
}

export interface Channel {
  name: 'email' | 'sms' | 'push';
  enabled: boolean;
  send(msg: OutboundMessage): Promise<void>;
}

const env = (k: string) => process.env[k]?.trim() || '';

/** Email via Resend (https://resend.com). Env: RESEND_API_KEY, EMAIL_FROM */
export const emailChannel: Channel = {
  name: 'email',
  enabled: Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM')),
  async send(msg) {
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
        <p style="color:#4A5652;font-size:13px;margin:0 0 8px">${escapeHtml(msg.orgName)}</p>
        <h2 style="margin:0 0 12px;color:#0F1A17">${escapeHtml(msg.subject)}</h2>
        <p style="color:#0F1A17;font-size:15px;line-height:1.5">${escapeHtml(msg.text)}</p>
        ${msg.link ? `<p><a href="${msg.link}" style="display:inline-block;background:#0E9F8E;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">View in app</a></p>` : ''}
        <p style="color:#7A8683;font-size:12px;margin-top:24px">Sent via ScrubHub</p>
      </div>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('EMAIL_FROM'), to: [msg.to], subject: `${msg.subject} · ${msg.orgName}`, html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  },
};

/** SMS via Twilio. Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER */
export const smsChannel: Channel = {
  name: 'sms',
  enabled: Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM_NUMBER')),
  async send(msg) {
    const sid = env('TWILIO_ACCOUNT_SID');
    const body = new URLSearchParams({
      From: env('TWILIO_FROM_NUMBER'),
      To: msg.to,
      Body: `${msg.orgName}: ${msg.subject}. ${msg.text}${msg.link ? ` ${msg.link}` : ''}`.slice(0, 480),
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  },
};

/**
 * Web push placeholder. To enable: generate VAPID keys, store browser push
 * subscriptions in a `push_subscriptions` table, and send with the `web-push`
 * package here. Kept disabled so the dispatcher skips it cleanly.
 */
export const pushChannel: Channel = {
  name: 'push',
  enabled: false,
  async send() { /* not configured */ },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
