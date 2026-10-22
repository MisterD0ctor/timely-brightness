# Timely Brightness

A GNOME Shell extension that dims external monitors through DDC/CI as the sun
sets and brightens them again at sunrise.

The top bar menu shows today's brightness against the clock. Drag its points to
set the **dusk** level (at sunrise and sunset) and the **night** level (once civil
twilight ends). The slider shows the current brightness. Moving it pauses
**Follow the sun** until the next sunrise or sunset.

## How brightness follows the sun

Brightness is worked out from the sun's elevation, on this computer:

| Sun elevation              | Brightness                     |
| -------------------------- | ------------------------------ |
| above +6° (golden hour)    | 100                            |
| −0.833° (sunrise, sunset)  | dusk level                     |
| below −6° (civil twilight) | night level                    |
| in between                 | blended linearly by elevation  |

The fades therefore last as long as twilight does where you are: short near
the equinoxes and long in a Nordic summer.

Each monitor maps the 0–100 level onto its own range, set under **Monitors** in
the preferences.

## Requirements

- GNOME Shell 50
- `ddcutil` 2 or later, with access to `/dev/i2c-*` (its udev rule grants
  that to the logged-in user)
- DDC/CI turned on in each monitor's own menu

## Install

```sh
scripts/install.sh
```

This links `extension/` into `~/.local/share/gnome-shell/extensions/`. Log out
and back in, then enable it with `gnome-extensions enable timely-brightness@misterd0ctor.github.io`.
Set your latitude and longitude in the preferences.

## Development

```sh
gjs -m tests/sun.test.js        # sun position and brightness curve
scripts/headless-shell.sh <cmd> # run <cmd> against a headless shell with the extension
```

`headless-shell.sh` keeps test runs off the desktop and away from the real
monitors. It uses its own Wayland socket, D-Bus session and settings keyfile,
and replaces `ddcutil` with `scripts/fake-ddcutil`. See the script's header for
what it exports, and `scripts/shell-eval` for running code in that shell.
