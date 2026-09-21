/** Shared with client components, so it lives outside the server-only service. */
export const REPORT_REASONS = [
  'Harassment or bullying',
  'Hate speech',
  'Threats or violence',
  'Sexual exploitation',
  'Illegal content',
  'Spam',
  'Scam or fraud',
  'Impersonation',
  'Nudity or sexual content',
  'Something else',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
