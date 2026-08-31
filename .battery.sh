#!/bin/sh
# Every acceptance harness this session produced, one after another.
# Sequential on purpose: they seed and delete overlapping fixtures, and running
# them alongside anything else has already produced two false failures.
OUT=.battery.log
: > $OUT
for h in .trashqa.mjs .trashroles.mjs .trashui.mjs .delsweep.mjs .delwired.mjs \
         .overdraftqa.mjs .fivefixui.mjs .transferqa.mjs .payrollpickqa.mjs \
         .usdprimaryqa.mjs .refkindqa.mjs .tdsqa.mjs .challanqa.mjs .catdelqa.mjs .optionalref.mjs .sixqa.mjs .teamdocsqa.mjs .prorataqa.mjs .sheetqa.mjs .docviewqa.mjs .notspend.mjs .teamorderqa.mjs .resignqa.mjs .usdstableqa.mjs \
         .sessionqa.mjs \
         .sweep.mjs .pager.mjs .linkcheck.mjs .rolecheck.mjs .navchk.mjs; do
  if [ ! -f "$h" ]; then echo "MISSING $h" >> $OUT; continue; fi
  echo "===== $h =====" >> $OUT
  node "$h" >> $OUT 2>&1
  echo "exit=$? ($h)" >> $OUT
done
echo "BATTERY DONE" >> $OUT

node .dataintact.mjs   # replays the pending migrations and proves no figure moved

node .uploadqa.mjs      # the drawer knows what is on file, and a failure does not stick
node .previewsweep.mjs  # every picker that holds a file offers to show it

node .multidocqa.mjs    # several papers on one clip, and the slider
node .nofxqa.mjs        # a report reads no exchange rate
node .cardleakqa.mjs    # a card number appears in exactly one place

node .teambankqa.mjs    # the six bank fields, and no Wallet
node .payhistqa.mjs     # what pay has been, not only what it is
node .dateqa.mjs        # every screen reads dates day first
node .refqa.mjs         # one Reference, and an invoice that is a paper

node .lockedqa.mjs      # a closed month can be corrected, not rewritten

node .trashbulkqa.mjs   # restore and purge a ticked list, across kinds

node .subpayqa.mjs      # paying a subscription moves money, and obeys every rule
