"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { rateAction } from "@/app/actions";
import { formatRating, formatVotes, ratingTone } from "@/lib/ratings";
import { REACTIONS, type Reaction, type RatingTarget } from "@/lib/types";
import { Sheet } from "./Sheet";

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface RateTargetProps {
  targetType: RatingTarget;
  targetId: string;
  /** What the community says right now. */
  rating: number | null;
  votes: number;
  /** What this viewer already said, if anything. */
  myScore: number | null;
  myReactions?: Reaction[];
  signedIn: boolean;
  /** Shown in the sheet header, e.g. "@tommy" or "this post". */
  subject: string;
}

/**
 * One tap to open, one tap to score, one tap to send.
 *
 * Reactions are optional extra signal — the interface never asks for more than
 * a number, which is the only thing that has to be there.
 */
export function RateSheet(props: RateTargetProps & { onClose: () => void }) {
  const { targetType, targetId, rating, votes, myScore, subject, onClose } = props;
  const [score, setScore] = useState<number | null>(myScore);
  const [reactions, setReactions] = useState<Reaction[]>(
    props.myReactions ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(reaction: Reaction) {
    setReactions((current) =>
      current.includes(reaction)
        ? current.filter((value) => value !== reaction)
        : [...current, reaction],
    );
  }

  function submit() {
    if (score == null) return;
    setError(null);
    startTransition(async () => {
      const result = await rateAction(targetType, targetId, score, reactions);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Sheet
      title={`Rate ${subject}`}
      subtitle={
        votes > 0
          ? `${formatRating(rating)} from ${formatVotes(votes)}`
          : 'No ratings yet — yours is the first.'
      }
      onClose={onClose}
    >
      <div className="grid grid-cols-5 gap-2">
        {SCORES.map((value) => {
          const active = score === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setScore(value)}
              className={`rounded-2xl py-2.5 font-display text-lg font-bold tabular-nums transition active:scale-95 ${
                active
                  ? "bg-white text-ink-950"
                  : "border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10"
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>

      <p className="mt-2.5 text-center text-sm text-white/45">
        {score == null
          ? "Pick a score"
          : score >= 9
            ? "Outstanding"
            : score >= 7
              ? "Good"
              : score >= 5
                ? "Fine"
                : "Needs work"}
      </p>

      <p className="label mt-4">Add a reaction (optional)</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            aria-pressed={reactions.includes(reaction)}
            onClick={() => toggle(reaction)}
            className={`chip-tab ${reactions.includes(reaction) ? "chip-active" : "hover:bg-white/10"}`}
          >
            {reaction}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={score == null || pending}
        onClick={submit}
        className="btn-primary mt-5 w-full py-3.5"
      >
        {pending
          ? "Sending…"
          : myScore != null
            ? `Update to ${score ?? myScore}/10`
            : `Rate ${score ?? ""}/10`}
      </button>
      <p className="mt-3 text-center text-xs text-white/30">
        One rating per person. You can change yours any time.
      </p>
    </Sheet>
  );
}

/** The button that opens the sheet, showing the community score. */
export function RateButton({
  compact = false,
  ...props
}: RateTargetProps & { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const tone = ratingTone(props.rating);
  const rated = props.myScore != null;

  return (
    <>
      <button
        type="button"
        onClick={() =>
          props.signedIn
            ? setOpen(true)
            : // Back to whatever they were looking at, so the rating they came
              // to give is still one tap away after signing in.
              router.push(`/login?next=${encodeURIComponent(pathname)}`)
        }
        className={`inline-flex items-center gap-1.5 rounded-full border font-display font-bold tabular-nums transition active:scale-95 ${
          compact ? "min-h-[38px] px-3 py-1.5 text-[13px]" : "min-h-[44px] px-4 py-2 text-sm"
        } ${
          rated
            ? "border-mint/50 bg-mint/10 text-mint"
            : tone === "none"
              ? "border-dashed border-white/20 text-white/45 hover:text-white"
              : "border-white/[0.12] bg-white/[0.05] text-white hover:bg-white/10"
        }`}
        aria-label={
          rated
            ? `You rated this ${props.myScore}. Change your rating`
            : "Rate this"
        }
      >
        <span aria-hidden>★</span>
        {props.rating == null ? "Rate" : formatRating(props.rating)}
        {rated && (
          <span className="font-sans text-[10px] font-semibold opacity-70">
            you {props.myScore}
          </span>
        )}
      </button>
      {open && <RateSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
