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
 *   - Inline styles carry the design. The one <style> block only ADDS to it —
 *     phone spacing, a larger code on a wide screen, dark-mode guards — so a
 *     client that strips it (some Gmail contexts do) still gets the whole
 *     message, correctly laid out.
 *   - No JavaScript, no web fonts, no SVG, and no images at all — see `logo`.
 *   - Every colour stated explicitly, so a client's dark mode cannot invert
 *     half the message and leave the rest.
 *   - Gradients only ever ON TOP of a solid colour. Outlook for Windows and
 *     older Gmail apps ignore `background-image`, and what they show instead
 *     must still be FayTarra: the solid stop underneath.
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
  /** FayTarra pink: the button's solid fallback, the links, the accent. */
  fay: '#FF3D9A',
  faySoft: '#FF7DBE',
  /** The logo gradient, as three solid stops — no gradient survives Outlook. */
  aura: '#7C5CFF',
  solar: '#FFB443',
} as const;

/**
 * The site's own gradient — `.btn-primary` in globals.css, violet → pink →
 * amber at 120°. Only ever layered over a solid colour; see the rules above.
 */
const GRADIENT = `linear-gradient(120deg, ${BRAND.aura} 0%, ${BRAND.fay} 52%, ${BRAND.solar} 100%)`;

/**
 * Where the mail comes from and points at.
 *
 * Production only. These templates live in the Supabase dashboard, not in the
 * running app, so they cannot read `NEXT_PUBLIC_SITE_URL` — a literal is the
 * honest thing here, and it is the one place the domain is written down.
 */
export const SITE = 'https://faytarra.com';
export const SENDER = 'no-reply@faytarra.com';
/** Where a person who needs help writes to. Shown in every email. */
export const SUPPORT = 'support@faytarra.com';
/** The site's community rules page. */
export const RULES = `${SITE}/rules`;
/** FayTarra's line, as the site sets it on the sign-up page. */
export const TAGLINE = 'Everyone gets a say.';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, ui-monospace, Menlo, Consolas, 'Courier New', monospace";

/**
 * The logo, drawn rather than linked.
 *
 * FayTarra's mark is `src/app/icon.svg`: three ascending bars in a
 * violet → pink → amber gradient, with an amber spark above the tallest. Email
 * cannot use it as it is — SVG is unsupported in Gmail and Outlook — and a PNG
 * would be hidden by default in every client that blocks remote images, which
 * is most of them until the reader clicks "show images".
 *
 * So the bars are table cells with background colours, one per gradient stop,
 * and the spark is a character set in amber: both are things every client
 * draws, with images off, offline, the first time. Rounded corners fall back
 * to square corners in Outlook, which is the whole cost.
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
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>${bar(BRAND.aura, 16)}${bar(BRAND.fay, 28)}${bar(BRAND.solar, 40)}
                <!-- The spark: icon.svg's four-point star, as a glyph. -->
                <td valign="top" style="padding:0 0 0 1px;font-family:${FONT};font-size:15px;line-height:15px;color:${BRAND.solar};mso-line-height-rule:exactly;">&#10022;</td>
              </tr>
            </table>
          </td>
          <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
          <td valign="middle" class="fay-wordmark" style="font-family:${FONT};font-size:30px;line-height:34px;font-weight:800;letter-spacing:-0.6px;color:${BRAND.white};">FayTarra</td>
        </tr>
      </table>`;
}

/**
 * The violet → pink → amber line across the top of the email.
 *
 * Three cells, each a solid stop — which is all Outlook draws, and reads as
 * the brand on its own — with a gradient layered over each in every client
 * that can draw one, so there it is one continuous blend. The two in-between
 * colours are the midpoints of the stops either side, so the joins do not show.
 *
 * It sits above the logo rather than along the card's top edge on purpose:
 * email clients do not clip content to a rounded border, so a line inside the
 * card pokes out past its curved corners. Out here it has no corner to fight.
 */
function headerBar(): string {
  const auraFay = '#BE4DCD';
  const faySolar = '#FF7B6F';
  const cell = (solid: string, from: string, to: string, radius: string) =>
    `<td width="33%" height="4" bgcolor="${solid}" style="width:33%;height:4px;background-color:${solid};background-image:linear-gradient(90deg, ${from}, ${to});${radius}font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>`;
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr>
                  ${cell(BRAND.aura, BRAND.aura, auraFay, 'border-radius:2px 0 0 2px;')}
                  ${cell(BRAND.fay, auraFay, faySolar, '')}
                  ${cell(BRAND.solar, faySolar, BRAND.solar, 'border-radius:0 2px 2px 0;')}
                </tr>
              </table>`;
}

/**
 * A button that survives Outlook.
 *
 * Everywhere that can, it is the site's primary button: the FayTarra gradient
 * with dark text. The gradient sits over a solid FayTarra pink, so a client
 * that ignores `background-image` shows a pink button with the same dark
 * text — still legible, still on brand.
 *
 * Outlook for Windows ignores padding on an anchor and draws neither the
 * gradient nor the rounded cell, so the VML rectangle in the conditional
 * comment is what it actually draws: a solid pink pill. This is the standard
 * "bulletproof button", and it is worth the noise: the button IS the email.
 */
function button(label: string, href: string): string {
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" class="fay-btn" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="${BRAND.fay}" style="background-color:${BRAND.fay};background-image:${GRADIENT};border-radius:999px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:300px;" arcsize="50%" stroke="f" fillcolor="${BRAND.fay}">
                      <w:anchorlock/>
                      <center style="color:${BRAND.ink};font-family:${FONT};font-size:16px;font-weight:bold;">${label}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${href}" style="display:inline-block;padding:16px 40px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:bold;color:${BRAND.ink};text-decoration:none;border-radius:999px;">${label}</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>`;
}

/**
 * A marker naming the template, in the HTML source.
 *
 * These files are pasted into the Supabase dashboard by hand, which means the
 * dashboard and this repository can drift and nothing notices — an old
 * template keeps being sent, correctly, for as long as nobody re-pastes. That
 * is not hypothetical: the admin step-up shipped as a sign-in link because the
 * dashboard still held the previous Magic Link body.
 *
 * View source on a received email, or look at the top of the dashboard's
 * editor, and this line says which template is actually in use.
 */
const marker = (slug: string, kind: 'code' | 'link') =>
  `<!-- faytarra-template: ${slug} (${kind}) — regenerate with: npm run email:build -->`;

export interface EmailContent {
  /** Names this template in the rendered source. */
  slug: string;
  /** The subject line Supabase should send it with. */
  subject: string;
  /** The one-line summary the inbox shows next to the subject. */
  preheader: string;
  heading: string;
  /** Paragraphs above the button. */
  body: string[];
  action: { label: string; href: string } | null;
  /**
   * A one-time code, shown as the thing the reader is meant to copy.
   *
   * Separate from `body` because it must not look like a sentence: a code
   * set in the same 16px prose as the line above it is read past, not read
   * off. This renders it large, spaced, and monospaced so 0 and O cannot be
   * confused, in a panel of its own.
   */
  code?: string;
  /** Small print under the button — what the link does, and the "ignore this" line. */
  footnotes: string[];
  /**
   * Why this address got this email, for the footer — one sentence, starting
   * "You received this because…".
   */
  reason: string;
  /** Plain-text alternative, whole. */
  text: string;
}

const escape = (value: string) =>
  value.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A URL on its way into an href, or into visible text.
 *
 * The query string separators have to be written `&amp;` in HTML. A browser
 * forgives a raw `&` in an attribute; a strict email sanitiser rewriting the
 * document does not have to, and a link that loses `&type=signup` on the way
 * to the inbox is a confirmation link that cannot confirm anything. The Go
 * template placeholders pass through untouched — they contain no ampersands.
 */
const href = (value: string) => value.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;');

/**
 * Padding after the preheader.
 *
 * An inbox shows the first ~100–150 characters of a message next to the
 * subject. With only the preheader hidden up top, whatever comes next — the
 * wordmark, the heading — runs on after it in that preview. A run of
 * invisible, zero-width characters fills the space instead, so the preview is
 * the preheader and nothing else.
 */
const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(90);

/**
 * The one stylesheet, and everything in it is optional.
 *
 *   - Phones: tighter outer and card padding, a smaller heading, and a
 *     full-width button — the thumb target the rest of FayTarra uses.
 *   - Wider screens: a larger code. The inline size is the one that fits the
 *     narrowest phone, so this only ever grows it where there is room.
 *   - Dark mode: Outlook.com (`[data-ogsc]` / `[data-ogsb]`) and some Gmail
 *     apps re-tint a message they think is light. These pin the few colours
 *     that matter back to what they were designed as.
 *
 * Gmail drops a <style> block outright if anything in it fails to parse, so
 * nothing here is exotic: classes, two media queries, attribute selectors.
 */
const STYLE = `
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    @media only screen and (max-width: 520px) {
      .fay-outer { padding: 20px 10px !important; }
      .fay-card { padding: 30px 22px 26px !important; }
      .fay-h1 { font-size: 24px !important; line-height: 31px !important; }
      .fay-wordmark { font-size: 26px !important; line-height: 30px !important; }
      .fay-btn { width: 100% !important; }
      .fay-btn a { display: block !important; padding: 16px 20px !important; }
    }
    @media only screen and (min-width: 521px) {
      .fay-code { font-size: 38px !important; line-height: 46px !important; letter-spacing: 10px !important; }
    }
    [data-ogsc] .fay-h1, [data-ogsc] .fay-wordmark, [data-ogsc] .fay-code { color: ${BRAND.white} !important; }
    [data-ogsc] .fay-btn a { color: ${BRAND.ink} !important; }
    [data-ogsb] .fay-page { background-color: ${BRAND.ink} !important; }
    [data-ogsb] .fay-card { background-color: ${BRAND.panel} !important; }
  </style>`;

/** Renders one message to a complete HTML document. */
export function renderHtml(content: EmailContent): string {
  const paragraph = (text: string, color: string, size: number, bottom = 16) =>
    `<p style="margin:0 0 ${bottom}px;font-family:${FONT};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color};">${text}</p>`;
  const footerLink = (label: string, target: string) =>
    `<a href="${target}" style="color:${BRAND.body};text-decoration:underline;white-space:nowrap;">${label}</a>`;
  // Ordinary spaces around the dot, so a narrow screen can wrap between links;
  // each link itself stays on one line.
  const dot = ` <span style="color:${BRAND.faint};">&nbsp;&middot;&nbsp;</span> `;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
${marker(content.slug, content.action ? 'link' : 'code')}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <!-- Stops iOS and Outlook.com re-tinting a design that is already dark. -->
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escape(content.subject)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>body,table,td,a,p,h1{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->${STYLE}
</head>
<body class="fay-page" style="margin:0;padding:0;width:100%;background-color:${BRAND.ink};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- The inbox preview line, hidden in the message itself, then padded so
       nothing after it leaks into the preview. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${BRAND.ink};">${escape(content.preheader)}${PREHEADER_FILL}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.ink}" class="fay-page" style="background-color:${BRAND.ink};margin:0;padding:0;">
    <tr>
      <td align="center" class="fay-outer" style="padding:36px 16px;">

        <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
        <!-- Fluid everywhere that understands max-width (Apple Mail, iPhone
             Mail, Gmail, Outlook.com); pinned to 600px by the conditional
             above in Outlook for Windows, which ignores max-width. Without
             this pair, a fixed width="600" forces a sideways scroll on a phone. -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;">

          <!-- Brand line -->
          <tr>
            <td style="padding:0 0 30px;">${headerBar()}
            </td>
          </tr>

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:0 0 28px;">${logo()}
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td bgcolor="${BRAND.panel}" style="background-color:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr>
                  <td class="fay-card" style="padding:40px 40px 34px;">
              <h1 class="fay-h1" style="margin:0 0 18px;font-family:${FONT};font-size:28px;line-height:36px;font-weight:800;letter-spacing:-0.5px;color:${BRAND.white};">${escape(content.heading)}</h1>
              ${content.body.map((text) => paragraph(escape(text), BRAND.body, 16)).join('\n              ')}
${content.code ? `
              <!-- The code. Sized inline for the narrowest phone, so it can
                   never push the message sideways; wider screens enlarge it. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:8px 0 24px;">
                <tr>
                  <td align="center" bgcolor="${BRAND.ink}" style="background-color:${BRAND.ink};border:1px solid ${BRAND.line};border-radius:16px;padding:22px 8px;">
                    <div class="fay-code" style="font-family:${MONO};font-size:30px;line-height:38px;font-weight:bold;letter-spacing:4px;color:${BRAND.white};white-space:nowrap;">${escape(content.code)}</div>
                  </td>
                </tr>
              </table>` : ''}
${content.action ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr><td align="center" style="padding:12px 0 8px;">${button(escape(content.action.label), href(content.action.href))}
                </td></tr>
              </table>

              <!-- The same link as text: some clients strip buttons, and a
                   reader who wants to see where a link goes should be able to. -->
              <p style="margin:22px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.faint};">
                Button not working? Copy and paste this link into your browser:<br />
                <a href="${href(content.action.href)}" style="color:${BRAND.faySoft};text-decoration:underline;word-break:break-all;">${href(content.action.href)}</a>
              </p>` : ''}
${content.footnotes.length ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:28px 0 0;">
                <tr><td height="1" bgcolor="${BRAND.line}" style="height:1px;background-color:${BRAND.line};font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                <tr><td style="padding:22px 0 0;">
              ${content.footnotes.map((text, index, all) => paragraph(escape(text), BRAND.faint, 13, index === all.length - 1 ? 0 : 12)).join('\n              ')}
                </td></tr>
              </table>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:30px 16px 6px;">
              <p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:bold;color:${BRAND.white};">Everyone gets <span style="color:${BRAND.fay};">a say.</span></p>
              <p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:22px;color:${BRAND.body};">
                ${footerLink('faytarra.com', SITE)}${dot}${footerLink('Community rules', RULES)}${dot}${footerLink(SUPPORT, `mailto:${SUPPORT}`)}
              </p>
              <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.faint};">${escape(content.reason)}</p>
              <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.faint};">
                This is an automated message from ${SENDER}, so replies aren&rsquo;t read. Need help? Write to <a href="mailto:${SUPPORT}" style="color:${BRAND.faint};text-decoration:underline;">${SUPPORT}</a>.
              </p>
              <p style="margin:12px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.faint};">&copy; FayTarra</p>
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

/**
 * The plain-text footer, the same in every message: who it is from, where to
 * go, why it came, and where to get help.
 */
export function textFooter(reason: string): string {
  return [
    '--',
    `FayTarra — ${TAGLINE}`,
    'faytarra.com',
    `Community rules: ${RULES}`,
    `Help: ${SUPPORT}`,
    '',
    reason,
    `This is an automated message from ${SENDER}, so replies aren’t read.`,
  ].join('\n');
}
