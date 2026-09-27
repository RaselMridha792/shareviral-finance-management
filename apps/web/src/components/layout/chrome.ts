/**
 * The 42px square every button in the top bar is drawn as: the rail toggle,
 * the drawer on a phone, and the bell. The theme switch is the same height and
 * wider, because it carries a word.
 *
 * Its own file because the top bar and the bell both need it and the top bar
 * imports the bell — a constant in either would make the two import each other.
 */
export const CHROME_BUTTON =
  "inline-flex size-[42px] flex-none cursor-pointer items-center justify-center rounded-lg border bg-(--sv-subtle) transition-colors hover:bg-(--sv-violet-tint)";
