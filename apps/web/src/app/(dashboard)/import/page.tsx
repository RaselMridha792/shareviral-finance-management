import { permanentRedirect } from "next/navigation";

/**
 * The screen moved to `/data` when it stopped being only about importing.
 *
 * Left behind because a URL somebody bookmarked, or a link in an old note, is
 * not the sort of thing that announces itself before it breaks. `permanentRedirect`
 * rather than `redirect`: the move is not coming back, and a 308 lets a browser
 * stop asking.
 *
 * The query string travels: the assistant sends people here with `?batch=`,
 * and dropping it would land them on an empty file picker with their rows
 * already staged and invisible.
 */
export default async function ImportRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }
  const suffix = query.toString();
  permanentRedirect(suffix ? `/data?${suffix}` : "/data");
}
