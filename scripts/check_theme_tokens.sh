#!/bin/sh
# T9 guardrail: the frontends use design tokens only (docs/design-t9-theming.md, T8).
#
#   1. No raw Tailwind palette classes (bg-slate-800, text-white, ...).
#   2. No hex or rgb() colors outside the token files.
#   3. The shared theme files are identical in host, player and admin.
#
# A line containing `theme-ok` (e.g. `// theme-ok: <reason>`) is skipped by checks 1 and 2.
# Needs GNU grep (CI installs it on Alpine). Run from anywhere; exits 1 on any failure.

set -u
cd "$(dirname "$0")/.." || exit 1

APPS="frontend/host frontend/player frontend/admin"
fail=0

files=$(find frontend/host/src frontend/player/src frontend/admin/src -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) | sort)

# 1. Raw palette classes, with any variant prefix (hover:, focus:, ...) and opacity suffix.
PALETTE='\b(bg|text|border|ring|ring-offset|from|to|via|fill|stroke|placeholder|divide|outline|accent|shadow|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b'
out=$(echo "$files" | xargs grep -nHE "$PALETTE" | grep -v 'theme-ok')
if [ -n "$out" ]; then
  echo "Raw Tailwind palette classes (use a token from src/theme.css):"
  echo "$out"
  echo
  fail=1
fi

# 2. Hex and rgb()/rgba() colors. theme.css defines the tokens; lib/theme.ts builds rgb()
#    strings from them for canvas and QR code drawing.
color_files=$(echo "$files" | grep -vE '/src/theme\.css$|/src/lib/theme\.ts$')
HEX='(^|[^&A-Za-z0-9])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b'
out=$(echo "$color_files" | xargs grep -nHE "$HEX" | grep -v 'theme-ok')
out2=$(echo "$color_files" | xargs grep -nHE 'rgba?\(' | grep -vE 'rgba?\(var\(|theme-ok')
if [ -n "$out$out2" ]; then
  echo "Hardcoded colors (use a token; cssColor() in lib/theme.ts for canvas code):"
  [ -n "$out" ] && echo "$out"
  [ -n "$out2" ] && echo "$out2"
  echo
  fail=1
fi

# 3. Shared files must stay identical across the three apps.
for f in src/theme.css tailwind.tokens.ts src/lib/theme.ts; do
  for app in $APPS; do
    if [ ! -f "$app/$f" ]; then
      echo "Missing $app/$f"
      fail=1
    elif ! cmp -s "frontend/host/$f" "$app/$f"; then
      echo "$app/$f differs from frontend/host/$f (the copies must be identical)"
      fail=1
    fi
  done
done

if [ "$fail" -eq 0 ]; then
  echo "Theme tokens OK: no raw palette classes or hardcoded colors; shared files identical."
fi
exit "$fail"
