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

Under **Daily Rhythm** in the preferences, sunrise is pulled toward a morning
time and sunset toward an evening time, by a weight. Following the sun alone
would dim screens mid-afternoon in a Nordic winter and keep them bright toward
midnight in summer. Both work against a steady body clock. At the default
50 % toward 07:00 and 19:00, Stockholm's sunset moves from 14:48 to 16:54 at
midwinter and from 22:08 to 20:34 at midsummer. The time between two sunrises
and sunsets is stretched or squeezed evenly, so each fade keeps its shape.

Fades are followed in steps of 3 %. On some drivers (NVIDIA's, at least) every
DDC/CI transfer briefly stalls the desktop, so fewer, larger steps mean fewer
stalls. For the same reason, the slider sends its value once you pause or let
go, not while it moves.

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
