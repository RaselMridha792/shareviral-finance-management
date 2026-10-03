# Brief — HR Requests: approve a spend, then pay now or later; a "To pay" tab

**For:** one Claude session, HR Requests page only.
**From:** the planning session, 3 Oct 2026, from the owner's words and a screenshot.

## What the owner asked

> "ekhane ekbar aprove korar por eta to pay te jay, so eta evabe na kore jokhon aprove
> korbe tokhon etake multi-step forms banano jay tokhoni option dibe pay now or pay
> letter. tarpor pay now te click korle payment er window ta asbe r pay letter a click
> korle to-pay te jabe. opore jekhane filters gula ache oikhane to pay name ekta tab rakha
> jete pare"

What happens today, from the screenshot of the live site: approving a **spend** leaves it
on the Approved tab, labelled "To pay". Paying it is a separate trip, through the row's
pay button and the `PayDrawer` (`components/hr-budget/hr-budget-drawers.tsx`, as the
screen already does).

## What to build

1. **Approving a spend is two steps in the same drawer** (`decision-drawer.tsx`).
   - **Step 1** is the approval as it is now.
   - **Step 2** appears once the approval is saved, inside the same drawer: "Approved.
     Pay it now?", with two buttons:
     - **Pay now** opens the existing `PayDrawer` for that spend: account, reference and
       invoice uploads (#122), the same endpoint. Paying writes the expense, and the
       spend becomes Paid.
     - **Pay later** closes the drawer. The spend stays approved and unpaid, and shows
       on the new **To pay** tab.
   - Closing step 2 any other way is the same as Pay later. Say so in the step's text, so
     nobody thinks the approval was lost.
   - Only for a spend. A pay change, a one-off or a budget has nothing to pay; their
     approval stays one step.
   - Only for whoever may pay: the pay permission the `PayDrawer` route already checks.
     Someone who may approve but not pay sees step 1 only.
2. **A "To pay" tab** in the state filter:
   - order: Waiting, **To pay**, Approved, Rejected, Withdrawn, All;
   - with its count, like the others.
   - The API's state filter and `counts` gain `to_pay`: spends that are approved and not
     paid.
   - `apps/web/src/lib/hr-requests.ts` is this page's own client (`StateFilter`, the
     counts type). Its readers are this screen and the rail badge. Say so in the
     handover.
   - Whether Approved goes on listing unpaid spends is your call. The owner's words read
     as To pay being their home. Keep Approved as "everything approved", which is
     simplest, and say which you chose.
3. **The webhook still says what it says now.** Approving sends `approved`, and paying
   sends `approved` with `appliedAt` (#128). Nothing new goes to the HR portal.

## What to measure

- A harness on the real page:
  - approve a spend → step 2 → **Pay now** → the `PayDrawer` → pay → the row is Paid,
    and the ledger has the expense;
  - approve another → **Pay later** → it is on **To pay** with the count, and paying it
    from there works as before;
  - a pay change's approval is still one step.
- `.hrrequestsqa.mjs` and `.hrbudgetqa.mjs` still pass, and so do the four CI steps.
- **For the owner, on live:** the steps, in the handover.
