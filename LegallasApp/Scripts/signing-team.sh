#!/usr/bin/env bash
# Prints the team ID that signed a bundle, or nothing when it is signed ad hoc
# (or not at all). An empty result means the signature changes on every build.
#
# Usage: bash LegallasApp/Scripts/signing-team.sh <path/to/Legallas.app>
set -euo pipefail

team="$(codesign -dvv "$1" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
if [[ "$team" != "not set" ]]; then
    echo "$team"
fi
