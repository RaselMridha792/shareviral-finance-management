# -*- coding: utf-8 -*-
"""
Every text that acts as a link becomes blue and underlined — the owner's rule
after watching a table where nothing said which words could be clicked.

One canonical fragment, swapped in per site. The icon-only controls (edit
pencils, screenshot magnifier, receipt clip) are not text and are not touched.
"""
import io, sys

# The look: blue, always underlined, the underline soft until hovered.
LINK = "text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"

def sweep(path, pairs):
    s = io.open(path, encoding="utf-8").read()
    changed = 0
    for old, new in pairs:
        n = s.count(old)
        if n == 0:
            print("  MISS  %s: %s" % (path.split("/")[-1], old[:70])); sys.exit(1)
        s = s.replace(old, new)
        changed += n
    io.open(path, "w", encoding="utf-8", newline="\n").write(s)
    print("  ok  %-32s %d cell(s)" % (path.split("/")[-1], changed))
