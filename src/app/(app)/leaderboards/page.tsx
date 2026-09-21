import { permanentRedirect } from 'next/navigation';

/** Leaderboards became Rankings when ratings landed. */
export default function LeaderboardsRedirect() {
  permanentRedirect('/rankings');
}
