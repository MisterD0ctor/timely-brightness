#!/bin/sh
# Installs the extension for this user by linking this checkout into GNOME
# Shell's extension folder, so later edits apply after the next login.
set -eu

project=$(cd "$(dirname "$0")/.." && pwd)
extension="$project/extension"
uuid=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$extension/metadata.json")
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"

glib-compile-schemas "$extension/schemas"
mkdir -p "$(dirname "$target")"
if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "install.sh: $target exists and is not a link; leaving it alone" >&2
    exit 1
fi
ln -sfn "$extension" "$target"

echo "Linked $target"
echo "GNOME Shell only finds new extensions at login: log out and back in, then run"
echo "  gnome-extensions enable $uuid"
