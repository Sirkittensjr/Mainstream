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
import { renderHtml, SITE, type EmailContent } from './layout';

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
      '--',
      'FayTarra — faytarra.com',
      'Automated message. Replies are not monitored.',
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
      '--',
      'FayTarra — faytarra.com',
      'Automated message. Replies are not monitored.',
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
      '--',
      'FayTarra — faytarra.com',
      'Automated message. Replies are not monitored.',
    ].join('\n'),
  },

  {
    /**
     * FayTarra signs people in with a password, so nothing in the app asks for
     * a magic link. It is branded anyway: the alternative is that some path we
     * have not thought of sends Supabase's unbranded default, which is exactly
     * the thing this work is meant to stop.
     */
    slug: 'magic-link',
    dashboardTemplate: 'Magic Link',
    subject: 'Your FayTarra sign-in link',
    preheader: 'Sign in to FayTarra with this one-time link.',
    heading: 'Sign in to FayTarra',
    body: ['Use the link below to sign in to your FayTarra account.'],
    action: { label: 'Sign in to FayTarra', href: actionUrl('magiclink', '/home') },
    footnotes: [
      'This link signs in whoever opens it, once, and expires after a short time. Do not forward it to anybody.',
      'If you did not ask to sign in, you can safely ignore this email.',
    ],
    text: [
      'SIGN IN TO FAYTARRA',
      '',
      'Use the link below to sign in to your FayTarra account:',
      '',
      actionUrl('magiclink', '/home'),
      '',
      'This link signs in whoever opens it, once, and expires after a short time.',
      'Do not forward it to anybody.',
      '',
      'If you did not ask to sign in, you can safely ignore this email.',
      '',
      '--',
      'FayTarra — faytarra.com',
      'Automated message. Replies are not monitored.',
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
      '--',
      'FayTarra — faytarra.com',
      'Automated message. Replies are not monitored.',
    ].join('\n'),
  },

  {
    /** The only template with a code rather than a link. */
    slug: 'reauthentication',
    dashboardTemplate: 'Reauthentication',
    subject: 'Your FayTarra confirmation code',
    preheader: 'Enter this code to confirm it is you.',
    heading: 'Confirm it is you',
    body: [
      'Enter this code to confirm the change you asked for on your FayTarra account:',
      '{{ .Token }}',
    ],
    action: null,
    footnotes: [
      'The code expires after a short time. FayTarra will never ask you for it by email, message or phone.',
      'If you did not ask for this, ignore this email and change your password.',
    ],
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
      '--',
      'FayTarra — faytarra.com',
      'Automated message. Replies are not monitored.',
    ].join('\n'),
  },
];

export const renderEmail = (email: AuthEmail): string => renderHtml(email);

export { SITE };
