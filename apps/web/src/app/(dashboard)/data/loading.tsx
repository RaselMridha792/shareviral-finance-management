import {
  Skeleton,
  SkeletonHeader,
  SkeletonScreen,
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
      <div className="rounded-xl border border-border p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-10 w-full" />
        <Skeleton className="mt-4 h-10 w-full" />
        <Skeleton className="mt-4 h-10 w-2/3" />
        <Skeleton className="mt-6 h-9 w-32" />
      </div>
    </SkeletonScreen>
  );
}
