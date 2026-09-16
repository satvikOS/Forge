#!/bin/zsh
MARK=$1
trap 'print "GOT_USR1_AND_CONTINUED" >> $MARK' USR1
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  print "tick $i" >> $MARK
  sleep 1
done
print "FINISHED_CLEANLY" >> $MARK
exit 0
