# -*- coding: utf-8 -*-
"""
Move each screen's delete hook below the reload it closes over.

The hook was declared beside the other state, which reads well and is wrong:
`useTransactionDelete(() => refresh())` names `refresh` before the line that
declares it. The closure only runs on a click, long after both exist, so it
works — but the React compiler refuses to compile a component it cannot prove
that about, and a component it skips loses its memoisation silently. Below the
declaration it is both correct and provable.
"""
import io, re, sys

TARGETS = [
  ("apps/web/src/components/accounts/cash-in-screen.tsx", "const refresh = useCallback("),
  ("apps/web/src/components/accounts/register-screen.tsx", "const refresh = () => router.refresh();"),
  ("apps/web/src/components/expenses/category-detail-screen.tsx", "const refresh = () => router.refresh();"),
  ("apps/web/src/components/expenses/other-expenses-screen.tsx", "const load = useCallback("),
  ("apps/web/src/components/ledger/transactions-screen.tsx", "const load = useCallback("),
]

for path, anchor in TARGETS:
    s = io.open(path, encoding="utf-8").read()
    m = re.search(r'\n  const del = useTransactionDelete\([^\n]*\n', s)
    if not m:
        print("  MISS hook in " + path); sys.exit(1)
    line = m.group(0)
    s = s[:m.start()] + "\n" + s[m.end():]

    # After the anchor's whole statement: walk to the line that closes it.
    i = s.find("  " + anchor)
    if i < 0:
        print("  MISS anchor in " + path); sys.exit(1)
    if anchor.endswith(";"):
        end = s.index("\n", i) + 1
    else:
        # a useCallback: find its closing "}, [...]);" at this indent
        end = s.index("\n  }, [", i)
        end = s.index("\n", end + 6) + 1
    s = s[:end] + line + s[end:]
    io.open(path, "w", encoding="utf-8", newline="\n").write(s)
    print("  ok  " + path.split("/")[-1])
