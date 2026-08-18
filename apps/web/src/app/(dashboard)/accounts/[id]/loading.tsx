import {
  SkeletonCards,
  SkeletonHeader,
  SkeletonScreen,
} from "@/components/ui/skeleton";

/**
 * Shown the instant a link is clicked, until this route's data arrives.
 *
 * Cards rather than a table: this route is the account's own details now, and
 * a table skeleton followed by two panels is a page appearing to change shape
 * as it loads. The register keeps its table skeleton, beside the register.
 */
export default function Loading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonCards count={3} />
    </SkeletonScreen>
  );
}
