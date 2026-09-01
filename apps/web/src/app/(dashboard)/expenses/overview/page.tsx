import { ExpenseOverviewScreen } from "@/components/expenses/expense-overview-screen";

export const dynamic = "force-dynamic";

export const metadata = { title: "Expense overview · SFM" };

/**
 * `/expenses/overview`, and NOT `/expenses`.
 *
 * The category grid stays where it is, renamed "Operational expenses". Moving
 * it would break `category-detail-screen`'s way back, every
 * `/expenses/{slug}?from=&to=` bookmark, and the crumb every heading page
 * inherits — for no gain, since the owner asked for a NEW page rather than a
 * different one.
 */
export default function ExpenseOverviewPage() {
  return <ExpenseOverviewScreen />;
}
