import {
  SkeletonCards, SkeletonHeader, SkeletonScreen,
} from "@/components/ui/skeleton";

/**
 * Shown the instant a link is clicked, until this route's data arrives.
 *
 * Also what lets Next prefetch the route at all: every page here is
 * `force-dynamic`, and a dynamic route with no loading boundary has no static
 * shell to fetch ahead of time.
 */
export default function Loading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonCards count={6} />
    </SkeletonScreen>
  );
}
