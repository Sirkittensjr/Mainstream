/**
 * What a video post's caption is made of.
 *
 * The posting screen asks for a title and, folded away, a longer description.
 * A video post is an ordinary FayTarra post, so both end up in the one
 * `caption` the feed, the Videos feed, search and the post page already show —
 * the title as its first line. That is deliberately not a second column in the
 * database that only videos would ever use.
 */
export function postCaption(title: string, description = ''): string {
  return [title.trim(), description.trim()].filter(Boolean).join('\n\n');
}

/** The title as a reader sees it: the caption's first line. */
export function captionTitle(caption: string): string {
  return caption.split('\n')[0]?.trim() ?? '';
}
