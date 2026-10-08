/**
 * FayTarra's authentication emails, one entry per Supabase template.
 *
 * Supabase Auth owns all of this: it decides when to send, it mints the token,
 * and it substitutes the variables below when the mail goes out. These are the
 * bodies it substitutes into — nothing here sends mail, and nothing here
 * creates or validates a token.
 *
 * `{{ .ConfirmationURL }}` is Supabase's own action link. It already carries
 * the one-time code and the redirect, built from the project's Site URL and
 * the `emailRedirectTo` / `redirectTo` the app passed — which is why the
 * dashboard's URL configuration is what keeps these links off localhost, not
 * anything written here. See supabase/templates/README.md.
 *
 * Go template syntax, so `{{ .Thing }}` must survive rendering untouched.
 */
import { renderHtml, SITE, textFooter, type EmailContent } from './layout';

/**
 * The action link, built from Supabase's own token hash rather than from
 * `{{ .ConfirmationURL }}`.
 *
 * `{{ .ConfirmationURL }}` points at Supabase's /auth/v1/verify, which bounces
 * back to the app carrying a PKCE `code`. Exchanging that code needs the
 * code-verifier cookie written in the browser that signed up — so opening the
 * email on a different device, or in a mail app's in-app browser, fails on a
 * link that was perfectly valid. @supabase/ssr pins the client to PKCE, so
 * that is not something the app can opt out of.
 *
 * `{{ .TokenHash }}` has no such tie. The app hands it back to Supabase with
 * verifyOtp, server-side, and that one call both confirms the address and
 * returns the session — from any browser, on any device. This is Supabase's
 * own documented pattern for server-rendered apps.
 *
 * `{{ .SiteURL }}` is the project's Site URL, so the domain still comes from
 * the dashboard rather than from anything written here.
 */
const actionUrl = (type: string, next: string) =>
  `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=${type}&next=${next}`;


export interface AuthEmail extends EmailContent {
  /**
   * The file this is written to, and the dashboard template it belongs in.
   * Matches the names Supabase uses under Authentication → Emails.
   */
  slug:
    | 'confirm-signup'
    | 'reset-password'
    | 'change-email'
    | 'magic-link'
    | 'invite'
    | 'reauthentication';
  /** The heading in the dashboard this body is pasted under. */
  dashboardTemplate: string;
}

/**
 * The footer's "why you got this" line, per email. It says what happened, not
 * who did it: these go out on a request somebody made, and that may not have
 * been the reader.
 */
const REASON: Record<AuthEmail['slug'], string> = {
  'confirm-signup':
    'You received this because this email address was used to sign up for FayTarra.',
  'reset-password':
    'You received this because a password reset was requested for the FayTarra account that uses this email address.',
  'change-email':
    'You received this because a change of email address was requested for a FayTarra account that uses this email address.',
  'magic-link':
    'You received this because an administrator sign-in to FayTarra was started with this email address.',
  'invite':
    'You received this because this email address was invited to join FayTarra.',
  'reauthentication':
    'You received this because a change that needs your confirmation was requested on your FayTarra account.',
};

const IGNORE_SIGNUP =
  'If you did not create a FayTarra account, you can safely ignore this email — no account will be activated.';

export const EMAILS: AuthEmail[] = [
  {
    slug: 'confirm-signup',
    dashboardTemplate: 'Confirm signup',
    subject: 'Confirm your email address',
    preheader: 'One link and your FayTarra account is ready.',
    heading: 'Welcome to FayTarra',
    body: [
      'Thanks for joining FayTarra.',
      'Please verify your email address to finish creating your account.',
    ],
    action: { label: 'Verify my email', href: actionUrl('signup', '/home') },
    footnotes: [
      'This verification link confirms that this email address belongs to your FayTarra account. It can be used once, and it expires after a short time — if it has already expired, you can ask for a new one from the confirmation screen.',
      IGNORE_SIGNUP,
    ],
    reason: REASON['confirm-signup'],
    text: [
      'WELCOME TO FAYTARRA',
      '',
      'Thanks for joining FayTarra.',
      '',
      'Please verify your email address to finish creating your account:',
      '',
      actionUrl('signup', '/home'),
      '',
      'This verification link confirms that this email address belongs to your',
      'FayTarra account. It can be used once, and it expires after a short time.',
      '',
      'If you did not create a FayTarra account, you can safely ignore this email',
      '— no account will be activated.',
      '',
      textFooter(REASON['confirm-signup']),
    ].join('\n'),
  },

  {
    slug: 'reset-password',
    dashboardTemplate: 'Reset password',
    subject: 'Reset your FayTarra password',
    preheader: 'Choose a new password for your FayTarra account.',
    heading: 'Reset your FayTarra password',
    body: [
      'We received a request to reset the password for your FayTarra account.',
      'If you requested this, click below to choose a new password.',
    ],
    action: { label: 'Reset password', href: actionUrl('recovery', '/reset-password') },
    footnotes: [
      'For your security this link can be used once, and it expires according to the authentication system’s normal expiration rules. Your current password stays in place until you choose a new one.',
      'If you did not request a password reset, you can safely ignore this email — your password will not change.',
    ],
    reason: REASON['reset-password'],
    text: [
      'RESET YOUR FAYTARRA PASSWORD',
      '',
      'We received a request to reset the password for your FayTarra account.',
      '',
      'If you requested this, open the link below to choose a new password:',
      '',
      actionUrl('recovery', '/reset-password'),
      '',
      'For your security this link can be used once, and it expires according to',
      'the authentication system’s normal expiration rules. Your current password',
      'stays in place until you choose a new one.',
      '',
      'If you did not request a password reset, you can safely ignore this email',
      '— your password will not change.',
      '',
      textFooter(REASON['reset-password']),
    ].join('\n'),
  },

  {
    slug: 'change-email',
    dashboardTemplate: 'Change email address',
    subject: 'Confirm your new email address',
    preheader: 'Confirm the new address on your FayTarra account.',
    heading: 'Confirm your new email address',
    body: [
      'A request was made to change the email address on your FayTarra account from {{ .Email }} to {{ .NewEmail }}.',
      'Confirm the change below. Until you do, your account keeps its current address.',
    ],
    action: { label: 'Confirm new email', href: actionUrl('email_change', '/settings') },
    footnotes: [
      'This link can be used once and expires after a short time.',
      'If you did not ask to change your email address, ignore this email and consider changing your password — someone may know it.',
    ],
    reason: REASON['change-email'],
    text: [
      'CONFIRM YOUR NEW EMAIL ADDRESS',
      '',
      'A request was made to change the email address on your FayTarra account',
      'from {{ .Email }} to {{ .NewEmail }}.',
      '',
      'Confirm the change here. Until you do, your account keeps its current address:',
      '',
      actionUrl('email_change', '/settings'),
      '',
      'This link can be used once and expires after a short time.',
      '',
      'If you did not ask to change your email address, ignore this email and',
      'consider changing your password — someone may know it.',
      '',
      textFooter(REASON['change-email']),
    ].join('\n'),
  },

  {
    /**
     * The administrator's second-step code.
     *
     * This is Supabase's "Magic Link" template, which is what `signInWithOtp`
     * renders. FayTarra signs everybody in with a password and asks for a
     * one-time code in exactly one place — opening the admin dashboard — so
     * this template has one job, and `{{ .Token }}` is that code.
     *
     * Deliberately NOT a link. A link in an inbox is one forward or one
     * shoulder away from being used by somebody else; a code typed into a
     * screen the admin already has open are not.
     */
    slug: 'magic-link',
    dashboardTemplate: 'Magic Link',
    subject: 'Your FayTarra admin verification code',
    preheader: 'Your verification code for the FayTarra admin dashboard.',
    heading: 'Your admin verification code',
    body: ['Enter this code on FayTarra to open the admin dashboard:'],
    code: '{{ .Token }}',
    action: null,
    footnotes: [
      'The code expires shortly, works once, and asking for a new one cancels this one. FayTarra will never ask you for it by email, message or phone — only on the verification screen you opened yourself.',
      'If you did not just sign in as an administrator, this code is not yours to use: change the admin password immediately, because somebody else knows it.',
    ],
    reason: REASON['magic-link'],
    text: [
      'YOUR ADMIN VERIFICATION CODE',
      '',
      'Enter this code on FayTarra to open the admin dashboard:',
      '',
      '    {{ .Token }}',
      '',
      'The code expires shortly, works once, and asking for a new one cancels',
      'this one. FayTarra will never ask you for it by email, message or phone —',
      'only on the verification screen you opened yourself.',
      '',
      'If you did not just sign in as an administrator, this code is not yours',
      'to use: change the admin password immediately, because somebody else',
      'knows it.',
      '',
      textFooter(REASON['magic-link']),
    ].join('\n'),
  },

  {
    slug: 'invite',
    dashboardTemplate: 'Invite user',
    subject: 'You have been invited to FayTarra',
    preheader: 'Accept your invitation and set up your FayTarra account.',
    heading: 'You are invited to FayTarra',
    body: [
      'You have been invited to create an account on FayTarra — a place to post, be rated by the community, and be found on merit rather than follower count.',
      'Accept the invitation below to set up your account.',
    ],
    action: { label: 'Accept invitation', href: actionUrl('invite', '/home') },
    footnotes: [
      'This invitation link can be used once and expires after a short time.',
      'If you were not expecting this, you can safely ignore this email.',
    ],
    reason: REASON['invite'],
    text: [
      'YOU ARE INVITED TO FAYTARRA',
      '',
      'You have been invited to create an account on FayTarra.',
      '',
      'Accept the invitation here:',
      '',
      actionUrl('invite', '/home'),
      '',
      'This invitation link can be used once and expires after a short time.',
      'If you were not expecting this, you can safely ignore this email.',
      '',
      textFooter(REASON['invite']),
    ].join('\n'),
  },

  {
    /** The only template with a code rather than a link. */
    slug: 'reauthentication',
    dashboardTemplate: 'Reauthentication',
    subject: 'Your FayTarra confirmation code',
    preheader: 'Enter this code to confirm it is you.',
    heading: 'Confirm it is you',
    body: ['Enter this code to confirm the change you asked for on your FayTarra account:'],
    code: '{{ .Token }}',
    action: null,
    footnotes: [
      'The code expires after a short time. FayTarra will never ask you for it by email, message or phone.',
      'If you did not ask for this, ignore this email and change your password.',
    ],
    reason: REASON['reauthentication'],
    text: [
      'CONFIRM IT IS YOU',
      '',
      'Enter this code to confirm the change you asked for on your FayTarra account:',
      '',
      '    {{ .Token }}',
      '',
      'The code expires after a short time. FayTarra will never ask you for it by',
      'email, message or phone.',
      '',
      'If you did not ask for this, ignore this email and change your password.',
      '',
      textFooter(REASON['reauthentication']),
    ].join('\n'),
  },
];

export const renderEmail = (email: AuthEmail): string => renderHtml(email);

export { SITE };
