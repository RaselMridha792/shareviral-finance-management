# -*- coding: utf-8 -*-
"""
Wire one screen for deleting: the hook, the button, the dialog.

Three edits per screen and they are the same three every time, so they are
written once here rather than eight times by hand. Every replacement asserts,
because a silent no-op leaves a screen with a delete button and no dialog.
"""
import io, sys

def edit(path, pairs):
    s = io.open(path, encoding="utf-8").read()
    for old, new in pairs:
        if old not in s:
            print("  MISS in %s:\n    %s" % (path.split("/")[-1], old.strip()[:100]))
            sys.exit(1)
        if s.count(old) != 1:
            print("  AMBIGUOUS in %s (%d matches): %s" % (path.split("/")[-1], s.count(old), old.strip()[:70]))
            sys.exit(1)
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="\n").write(s)
    print("  ok  " + path.split("/")[-1])
