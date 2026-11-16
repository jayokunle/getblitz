/**
 * Shutdown notice e-mail templates (plain text).
 *
 * Source of truth for the approved wording. `shutdown/emails/*.txt` holds the
 * same text for review; templates.test.ts keeps both in sync.
 */

export type NoticeGroup = "A" | "B";

export interface RenderedNotice {
  subject: string;
  text: string;
}

const SHUTDOWN_AT_TEXT = "Thursday, 19 November 2026, 12:00 CET (Berlin time)";

const FOOTER = `Jacob Ayokunle
GetBlitz – JAyokunle Enterprise UG (haftungsbeschränkt), Augsburg, Germany
Impressum: https://getblitz.io/en/impressum
Reply to this email for any questions.
`;

export function renderGroupA(orgName: string): RenderedNotice {
  return {
    subject:
      "GetBlitz is closing on 19 November 2026 – action needed for your integration",
    text: `Hello,

we are discontinuing the hosted GetBlitz service. The service at app.getblitz.io will stop on

    ${SHUTDOWN_AT_TEXT}

Your GetBlitz account (${orgName}) is set up to accept payments, so please read this carefully.

WHAT STOPS AT THAT TIME
- The checkout widget (@getblitz/client) and payment pages
- The REST API (api keys, client tokens) and the real-time WebSocket
- Webhooks to your systems
- The WooCommerce / WordPress plugin "GetBlitz Payment Gateway" (it connects to app.getblitz.io by default)

WHAT YOU NEED TO DO BEFORE 19 NOVEMBER, 12:00 CET
1. Remove the GetBlitz payment option from your checkout. If you use the WordPress plugin, deactivate and delete it, and switch to another payment provider.
2. Remove GetBlitz's access to your bank account:
   - Wise: in your Wise business account settings, delete the API token you created for GetBlitz.
   - Qonto: in your Qonto settings, revoke the GetBlitz app connection (connected apps / integrations).
   We will also delete the bank webhooks and all stored credentials on our side at shutdown.
3. Export any data you want to keep (see below).

YOUR DATA
After the shutdown, your account and all associated data (payment sessions, customers, invoices, bank connection settings, API keys) will be permanently deleted.
To keep a copy, you can either use the API (GET /api/v1/sessions, /api/v1/customers, /api/v1/invoices with your API key) before the shutdown, or simply reply to this email and we will send you an export of your data before the shutdown.

DID A CUSTOMER PAYMENT GO MISSING?
If you think a real customer payment may not have been registered correctly in GetBlitz, please reply to this email before the shutdown so we can look into it with you.

SELF-HOSTING
GetBlitz is MIT-licensed open-source software. If you would like to keep using it, you can run it on your own server. The source code and instructions remain available at:
https://github.com/jayokunle/getblitz

Thank you for trying GetBlitz.

${FOOTER}`,
  };
}

export function renderGroupB(): RenderedNotice {
  return {
    subject: "GetBlitz is closing on 19 November 2026",
    text: `Hello,

we are discontinuing the hosted GetBlitz service. The service at app.getblitz.io will stop on

    ${SHUTDOWN_AT_TEXT}

You are receiving this because you have a GetBlitz account. Your account has not processed any payments, so no action is needed.

After the shutdown, your account and all associated data will be permanently deleted.

GetBlitz remains available as MIT-licensed open-source software that you can host yourself: https://github.com/jayokunle/getblitz

Thank you for trying GetBlitz.

${FOOTER}`,
  };
}
