"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The sheet's own width: A4 at 96 pixels to the inch. */
export const SHEET_WIDTH = 794;

/**
 * The A4 sheet at its real size where there is room, zoomed down to the box
 * where there is not — so the whole page is in view rather than scrolled
 * sideways. The builder's preview and an invoice's popup both draw it so.
 */
export function SheetFit({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? SHEET_WIDTH;
      setScale(Math.min(1, width / SHEET_WIDTH));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="flex justify-center">
      <div style={{ zoom: scale }} data-invoice-preview>
        {children}
      </div>
    </div>
  );
}
