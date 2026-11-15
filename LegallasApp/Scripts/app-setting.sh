#!/usr/bin/env bash
# Prints one of the app target's build settings as the xcconfig files give it:
# Config/Legallas.xcconfig, then a room's Config/Room.xcconfig if there is one.
#
# Usage: bash LegallasApp/Scripts/app-setting.sh PRODUCT_NAME
set -euo pipefail

config="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Config" && pwd)"
value=""
for file in "$config/Legallas.xcconfig" "$config/Room.xcconfig"; do
    [[ -f "$file" ]] || continue
    found="$(sed -n "s/^$1[[:space:]]*=[[:space:]]*//p" "$file" | tail -n 1)"
    [[ -z "$found" ]] || value="$found"
done
if [[ -z "$value" ]]; then
    echo "error: no build setting named $1" >&2
    exit 1
fi
printf '%s\n' "$value"
