# -*- coding: utf-8 -*-
"""
Give each deletable table its three columns, by parsing rather than guessing.

Every `pgTable("name", { ... })` has its columns in an object literal; the
close of that literal is found by matching braces from the open, so a table
whose columns are laid out differently from its neighbours still gets the
insert in the right place. Blind line-number patching across seventeen tables
in eleven files is how one lands inside a nested `{ withTimezone: true }`.
"""
import io, re, sys

TABLES = {
  "accounts.ts": ["accounts"],
  "categories.ts": ["categories"],
  "fx.ts": ["fx_rates"],
  "imports.ts": ["import_batches"],
  "statements.ts": ["statements"],
  "subscriptions.ts": ["subscriptions", "subscription_users"],
  "tax.ts": ["tds_deposits", "withholding_returns", "income_tax_records"],
  "team.ts": ["team_members", "compensation_history", "payroll_runs"],
  "transactions.ts": ["transactions"],
  "users.ts": ["users"],
  "vendors.ts": ["vendors"],
  "files.ts": ["files"],
}

BASE = "apps/api/src/db/schema/"
done, failed = [], []

for fname, tables in TABLES.items():
    path = BASE + fname
    s = io.open(path, encoding="utf-8").read()

    for t in tables:
        m = re.search(r'pgTable\(\s*"%s"\s*,\s*\{' % re.escape(t), s)
        if not m:
            failed.append("%s: no pgTable(%s)" % (fname, t)); continue

        open_brace = m.end() - 1
        depth, i = 0, open_brace
        while i < len(s):
            if s[i] == "{": depth += 1
            elif s[i] == "}":
                depth -= 1
                if depth == 0: break
            i += 1
        if depth != 0:
            failed.append("%s: unbalanced braces in %s" % (fname, t)); continue

        block = s[open_brace:i]
        if "...deletion()" in block:
            done.append("%-22s already had it" % t); continue

        # An existing single-line deletedAt becomes the spread, so the three
        # columns are declared in one place rather than two.
        line = re.search(r'\n(\s*)deletedAt: timestamp\("deleted_at", \{ withTimezone: true \}\),', block)
        if line:
            indent = line.group(1)
            new_block = block[:line.start()] + "\n" + indent + "...deletion()," + block[line.end():]
            done.append("%-22s replaced its deletedAt" % t)
        else:
            indent = re.search(r'\n(\s*)\S', block).group(1)
            new_block = block.rstrip() 
            if not new_block.endswith(","): new_block += ","
            new_block += "\n" + indent + "...deletion(),\n" + " " * (len(indent) - 2)
            done.append("%-22s gained the three" % t)

        s = s[:open_brace] + new_block + s[i:]

    if "shared-columns" in s:
        # already imports something from there
        if "deletion" not in s.split("\n")[0:40].__str__() or "deletion," not in s:
            s = re.sub(r'import \{ ([^}]*?) \} from "\./shared-columns";',
                       lambda mm: 'import { %s } from "./shared-columns";' % ", ".join(sorted(set(
                           [x.strip() for x in mm.group(1).split(",") if x.strip()] + ["deletion"]))),
                       s, count=1)
    else:
        lines = s.split("\n")
        last_import = max(i for i, l in enumerate(lines) if l.startswith("import "))
        lines.insert(last_import + 1, 'import { deletion } from "./shared-columns";')
        s = "\n".join(lines)

    io.open(path, "w", encoding="utf-8", newline="\n").write(s)

print("\n".join("  " + d for d in done))
if failed:
    print("\nFAILED:"); print("\n".join("  " + f for f in failed)); sys.exit(1)
