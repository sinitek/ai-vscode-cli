#!/bin/bash
node "$(dirname "$0")/verify_loop_plus_fix.js" --live "$@"
exit $?
