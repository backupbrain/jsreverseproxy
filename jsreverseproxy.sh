#!/usr/bin/env bash
NODE=`which node`
SCRIPT_PATH="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
$NODE $SCRIPT_PATH/src/index $@
