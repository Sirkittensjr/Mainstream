/**
 * The shell every FayTarra authentication email is built in.
 *
 * These are rendered to static HTML and pasted into Supabase's own email
 * templates (Authentication → Emails), so Supabase keeps sending the mail —
 * there is no second mailer here, and no verification token is ever minted by
 * this code. What the templates change is only how the message looks.
 *
 * Email is not the web. The rules this file follows, because Outlook (Word's
 * rendering engine), Gmail's sanitiser and ten years of iPhone Mail versions
 * all have to agree:
 *
 *   - Tables for layout. No flex, no grid, no position.
 *   - Inline styles only. Gmail strips <style> in some contexts, and no
 *     external stylesheet is ever fetched.
 *   - No JavaScript, no web fonts, no SVG, and no images at all — see LOGO.
 *   - Every colour stated explicitly, so a client's dark mode cannot invert
 *     half the message and leave the rest.
 *   - Widths in px on tables, with a max-width for the phone.
 *   - A plain-text alternative for every message.
 */

/** FayTarra's palette, the same values tailwind.config.ts uses for the site. */
export const BRAND = {
  /** Page behind the card. */
  ink: '#06060A',
  /** The card itself. */
  panel: '#101019',
  /** Hairline borders. */
  line: '#232331',
  /** Headings and anything that must read as primary. */
  white: '#FFFFFF',
  /** Body copy on the dark panel — deliberately light enough to pass contrast. */
  body: '#B9B9C6',
  /** The quiet footer line. */
  faint: '#77778A',
  /** FayTarra pink: the button, the links, the accent. */
  fay: '#FF3D9A',
  faySoft: '#FF7DBE',
  /** The logo gradient, as three solid stops — no gradient survives Outlook. */
  aura: '#7C5CFF',
  solar: '#FFB443',
} as const;

/**
 * Where the mail comes from and points at.
 *
 * Production only. These templates live in the Supabase dashboard, not in the
 * running app, so they cannot read `NEXT_PUBLIC_SITE_URL` — a literal is the
 * honest thing here, and it is the one place the domain is written down.
 */
export const SITE = 'https://faytarra.com';
export const SENDER = 'no-reply@faytarra.com';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * The logo, drawn rather than linked.
 *
 * FayTarra's mark is `src/app/icon.svg`: three ascending bars in a
 * violet → pink → amber gradient, with an amber spark. Email cannot use it as
 * it is — SVG is unsupported in Gmail and Outlook — and a PNG would be hidden
 * by default in every client that blocks remote images, which is most of them
 * until the reader clicks "show images".
 *
 * So the bars are table cells with background colours, one per gradient stop.
 * Solid colour on a fixed-size cell is the single most portable thing in
 * email: it renders in every client, with images off, offline, first time.
 * Rounded corners fall back to square corners in Outlook, which is the whole
 * cost.
 */
function logo(): string {
  const bar = (color: string, height: number) => `
            <td width="12" valign="bottom" style="padding:0 3px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="12" style="width:12px;">
                <tr><td height="${height}" width="12" bgcolor="${color}" style="width:12px;height:${height}px;background-color:${color};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>`;

  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr>
          <td valign="bottom" style="padding:0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${bar(BRAND.aura, 16)}${bar(BRAND.fay, 28)}${bar(BRAND.solar, 40)}
            </tr></table>
          </td>
          <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
          <td valign="middle" style="font-family:${FONT};font-size:27px;line-height:30px;font-weight:bold;letter-spacing:2px;color:${BRAND.white};text-transform:uppercase;">FayTarra</td>
        </tr>
      </table>`;
}

/**
 * A button that survives Outlook.
 *
 * Outlook ignores padding on an anchor, so the shape is a table cell and the
 * VML rectangle in the conditional comment is what Outlook actually draws.
 * Everything else uses the table. This is the standard "bulletproof button",
 * and it is worth the noise: the button IS the email.
 */
function button(label: string, href: string): string {
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="${BRAND.fay}" style="background-color:${BRAND.fay};border-radius:999px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:300px;" arcsize="50%" stroke="f" fillcolor="${BRAND.fay}">
                      <w:anchorlock/>
                      <center style="color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:bold;">${label}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${href}" style="display:inline-block;padding:16px 38px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;background-color:${BRAND.fay};">${label}</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>`;
}

export interface EmailContent {
  /** The subject line Supabase should send it with. */
  subject: string;
  /** The one-line summary the inbox shows next to the subject. */
  preheader: string;
  heading: string;
  /** Paragraphs above the button. */
  body: string[];
  action: { label: string; href: string } | null;
  /** Small print under the button — what the link does, and the "ignore this" line. */
  footnotes: string[];
  /** Plain-text alternative, whole. */
  text: string;
}

const escape = (value: string) =>
  value.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders one message to a complete HTML document. */
export function renderHtml(content: EmailContent): string {
  const paragraph = (text: string, color: string, size: number) =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color};">${text}</p>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <!-- Stops iOS and Outlook.com re-tinting a design that is already dark. -->
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escape(content.subject)}</title>
  <!--[if mso]>
  <style>body,table,td,a,p{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.ink};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- The inbox preview line, hidden in the message itself. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(content.preheader)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.ink}" style="background-color:${BRAND.ink};margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
        <!-- Fluid everywhere that understands max-width (Apple Mail, iPhone
             Mail, Gmail, Outlook.com); pinned to 600px by the conditional
             above in Outlook for Windows, which ignores max-width. Without
             this pair, a fixed width="600" forces a sideways scroll on a phone. -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:8px 0 28px;">${logo()}
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td bgcolor="${BRAND.panel}" style="background-color:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:20px;padding:36px 28px;">
              <h1 style="margin:0 0 18px;font-family:${FONT};font-size:27px;line-height:33px;font-weight:bold;letter-spacing:-0.5px;color:${BRAND.white};">${escape(content.heading)}</h1>
              ${content.body.map((text) => paragraph(escape(text), BRAND.body, 16)).join('\n              ')}
${content.action ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td align="center" style="padding:14px 0 10px;">${button(escape(content.action.label), content.action.href)}
                </td></tr>
              </table>

              <!-- The same link as text: some clients strip buttons, and a
                   reader who wants to see where a link goes should be able to. -->
              <p style="margin:18px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.faint};">
                Button not working? Copy and paste this link into your browser:<br />
                <a href="${content.action.href}" style="color:${BRAND.faySoft};text-decoration:underline;word-break:break-all;">${content.action.href}</a>
              </p>` : ''}
${content.footnotes.length ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="padding:24px 0 0;border-top:1px solid ${BRAND.line};"></td></tr>
              </table>
              ${content.footnotes.map((text) => paragraph(escape(text), BRAND.faint, 13)).join('\n              ')}` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:26px 12px 8px;">
              <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.faint};">
                <a href="${SITE}" style="color:${BRAND.faint};text-decoration:none;">faytarra.com</a>
              </p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.faint};">
                Sent by FayTarra. This is an automated message from ${SENDER} — replies are not monitored.
              </p>
              <p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.faint};">&copy; FayTarra</p>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
