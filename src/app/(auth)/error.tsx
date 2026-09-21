'use client';

import { ErrorScreen } from '@/components/ErrorScreen';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      reset={reset}
      title="We could not load that"
      body="Signing in and joining are working — this screen just failed to render. Try again."
    />
  );
}
