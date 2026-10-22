#!/bin/sh
# Run a command against a headless GNOME Shell with this extension enabled.
#
#   scripts/headless-shell.sh <command...>
#   scripts/headless-shell.sh sh -c 'scripts/shell-eval "Main.panel.statusArea[\"$UUID\"].menu.open()"'
#
# Nothing of it reaches the desktop or the real monitors. A window on the
# desktop would take focus from whoever is working there, so the shell runs
# headless on a Wayland socket and D-Bus session of its own. Its settings live
# in a keyfile in a scratch directory instead of dconf, and `ddcutil` is
# scripts/fake-ddcutil.
#
# The command runs inside that D-Bus session once the extension is up, with
# unsafe mode on so org.gnome.Shell.Eval and the screenshot API answer. These
# are exported to it:
#   UUID                 the extension's uuid
#   TIMELY_FAKE_DDC_DIR  fake monitor state and calls.log
#   TIMELY_SHELL_LOG     the shell's own output, where extension errors land
#
# TIMELY_KEEP=1 keeps the scratch directory afterwards.
set -eu

if [ $# -eq 0 ]; then
    echo "usage: $0 <command...>" >&2
    exit 2
fi

# Second stage, inside the private D-Bus session started below.
if [ "${TIMELY_IN_SESSION:-}" ]; then
    gsettings set org.gnome.shell enabled-extensions "['$UUID', 'harness@timely-brightness']"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'

    # In a session of its own: sharing a process group, the shell's shutdown
    # now and then took this script down with a signal, failing the run.
    setsid gnome-shell --headless --wayland --no-x11 --wayland-display="$WAYLAND_DISPLAY" \
        --virtual-monitor "${TIMELY_HEADLESS_SIZE:-1280x800}" >"$TIMELY_SHELL_LOG" 2>&1 &
    shell=$!
    trap 'kill "$shell" 2>/dev/null || true; wait "$shell" 2>/dev/null || true' EXIT

    tries=0
    until gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "!!Main.panel.statusArea['$UUID']" 2>/dev/null |
        grep -q "true, 'true'"; do
        tries=$((tries + 1))
        if [ "$tries" -gt 150 ] || ! kill -0 "$shell" 2>/dev/null; then
            echo "headless-shell.sh: the extension did not come up:" >&2
            tail -n 40 "$TIMELY_SHELL_LOG" >&2
            exit 1
        fi
        sleep 0.2
    done

    "$@"
    exit
fi

project=$(cd "$(dirname "$0")/.." && pwd)
extension="$project/extension"
UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$extension/metadata.json")
export UUID

glib-compile-schemas "$extension/schemas"

scratch=$(mktemp -d "${XDG_RUNTIME_DIR:?}/timely-headless-XXXXXX")
cleanup() {
    if [ "${TIMELY_KEEP:-}" ]; then
        echo "kept $scratch" >&2
    else
        rm -rf "$scratch"
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir -p "$scratch/data/gnome-shell/extensions" "$scratch/config" "$scratch/bin" "$scratch/ddc"
ln -s "$extension" "$scratch/data/gnome-shell/extensions/$UUID"
ln -s "$project/scripts/fake-ddcutil" "$scratch/bin/ddcutil"

# Eval and screenshots are refused outside unsafe mode, and only an extension
# can turn it on without the Looking Glass.
harness="$scratch/data/gnome-shell/extensions/harness@timely-brightness"
mkdir -p "$harness"
cat >"$harness/metadata.json" <<'EOF'
{"uuid": "harness@timely-brightness", "name": "Harness", "description": "Unsafe mode for tests", "shell-version": ["50"]}
EOF
cat >"$harness/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class Harness extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }
}
EOF

export XDG_DATA_HOME="$scratch/data"
export XDG_CONFIG_HOME="$scratch/config"
export GSETTINGS_BACKEND=keyfile
export PATH="$scratch/bin:$PATH"
export TIMELY_FAKE_DDC_DIR="$scratch/ddc"
export TIMELY_SHELL_LOG="$scratch/shell.log"
# Set before the D-Bus session starts, so services it launches, such as the
# preferences window, can only reach the headless shell, never the desktop's
# default socket.
export WAYLAND_DISPLAY="timely-headless-$$"
unset DISPLAY

TIMELY_IN_SESSION=1 dbus-run-session -- "$0" "$@"
