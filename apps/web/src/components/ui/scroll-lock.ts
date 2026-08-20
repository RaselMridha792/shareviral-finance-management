"use client";

import { useEffect } from "react";

/**
 * Holding the page still while something is over it — counted, not saved.
 *
 * There is one `body.style.overflow` and several things that want it: a
 * drawer, a confirm dialog raised from inside that drawer, the "add a
 * category" drawer that opens from a transaction form. Each used to remember
 * the value it found and put that back on close, which is only correct while
 * exactly one of them exists. Nested, the inner one finds `hidden` and records
 * *that* as the value to restore, so closing both leaves the page locked until
 * a reload. Measured on the Expenses page, where the heading chooser opens a
 * second drawer inside itself: body stayed `hidden` after everything closed.
 *
 * So the value is read once, by the first to ask, and put back once, by the
 * last to let go.
 */
let holders = 0;
let released = "";

/**
 * Stops the page behind from scrolling for as long as `active` is true.
 *
 * `active` is the only dependency on purpose. Callers pass inline `onClose`
 * handlers that change identity on every render; with one of those in the
 * list the lock tore down and set itself up again mid-life, re-reading the
 * value to restore from a page that was already locked.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (holders === 0) {
      released = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    holders += 1;

    return () => {
      holders -= 1;
      if (holders === 0) document.body.style.overflow = released;
    };
  }, [active]);
}
