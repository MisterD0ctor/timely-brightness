import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import {SunClock} from './clock.js';
import {DAY_LEVEL, levelAt, sunDay} from './curve.js';
import {detect} from './ddc.js';
import {sunElevation} from './sun.js';

// Brightness moves about 1 % per minute at its steepest, so following the sun
// more often would only add DDC writes.
const TICK_SECONDS = 60;

// Each DDC write can stall the compositor (see ddc.js), so fades are followed
// in steps of this many percent rather than every minute.
const FADE_STEP = 3;

// Monitors that have just been plugged in or woken take a moment before
// they answer DDC/CI.
const REDETECT_DELAY_SECONDS = 3;

// A drag changes the level dozens of times a second, and on NVIDIA every DDC
// write stalls the compositor briefly, so a level set by hand is sent once it
// has stopped changing for this long.
const SETTLE_MS = 250;

/**
 * Decides the brightness and sends it to the monitors: follows the sun while
 * Auto is on, and holds a level set by hand until the next sunrise or sunset.
 *
 * Levels are on a 0–100 scale that each monitor maps onto its own range from
 * the `monitors` setting.
 *
 * Signals:
 * - `level-changed` (level): the brightness level changed.
 * - `changed`: a setting the UI shows changed.
 */
export class Controller extends EventEmitter {
    /** @param {Gio.Settings} settings */
    constructor(settings) {
        super();
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._monitors = [];
        this._detection = 0;
        this._redetectId = 0;
        this._writeId = 0;

        /** The current level, or null until the sun or a monitor has given one. */
        this.level = null;

        this._settings.connectObject('changed', (_settings, key) => this._onSettingChanged(key), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._scheduleDetect(), this);

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        this._detect();
    }

    destroy() {
        this._cancellable.cancel();
        GLib.source_remove(this._tickId);
        if (this._redetectId)
            GLib.source_remove(this._redetectId);
        if (this._writeId)
            GLib.source_remove(this._writeId);
        this._settings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
    }

    get auto() {
        return this._settings.get_boolean('auto');
    }

    /** When Auto comes back on by itself, or null if it was switched off by hand. */
    get resumeAt() {
        const seconds = this._settings.get_int64('resume-at');
        return seconds ? new Date(seconds * 1000) : null;
    }

    get dusk() {
        return this._settings.get_int('dusk-level');
    }

    get night() {
        return this._settings.get_int('night-level');
    }

    /** Today's path of the sun, moved toward the set times, for drawing. */
    sunDay() {
        const now = new Date();
        return sunDay(now, ...this._location(), this._sunClock(now));
    }

    /** The level the sun, moved toward the set times, calls for at `date`. */
    sunLevel(date = new Date()) {
        const sunTime = this._sunClock(date).toSun(date);
        return levelAt(sunElevation(sunTime, ...this._location()), this.dusk, this.night);
    }

    /** @param {boolean} auto */
    setAuto(auto) {
        this._settings.set_int64('resume-at', 0);
        this._settings.set_boolean('auto', auto);
    }

    /**
     * Sets the brightness by hand. While Auto is on, this pauses it until the
     * next sunrise or sunset. The monitors follow once the level settles.
     *
     * @param {number} level - 0–100
     */
    setManualLevel(level) {
        if (this.auto) {
            const now = new Date();
            const resumeAt = this._sunClock(now).nextChange(now);
            this._settings.set_int64('resume-at', resumeAt ? Math.floor(resumeAt / 1000) : 0);
            this._settings.set_boolean('auto', false);
        }
        this._setLevel(level);
        this._scheduleWrite();
    }

    /**
     * @param {object} levels
     * @param {number} levels.dusk - 0–100
     * @param {number} levels.night - 0–100
     */
    setLevels({dusk, night}) {
        this._settings.set_int('dusk-level', Math.round(dusk));
        this._settings.set_int('night-level', Math.round(night));
    }

    _location() {
        return [this._settings.get_double('latitude'), this._settings.get_double('longitude')];
    }

    _sunClock(date) {
        return new SunClock(date, ...this._location(), {
            morning: this._settings.get_int('morning-time'),
            evening: this._settings.get_int('evening-time'),
            weight: this._settings.get_int('rhythm-weight') / 100,
        });
    }

    _monitorSettings() {
        try {
            return JSON.parse(this._settings.get_string('monitors'));
        } catch {
            return {};
        }
    }

    _onSettingChanged(key) {
        if (key === 'monitors')
            this._write();
        else if (this.auto)
            this._follow();
        this.emit('changed');
    }

    _tick() {
        const {resumeAt} = this;
        if (resumeAt && Date.now() >= resumeAt.getTime())
            this.setAuto(true);
        else
            this._follow({stepped: true});
    }

    _follow({stepped = false} = {}) {
        if (!this.auto)
            return;
        const level = this.sunLevel();
        // A fade's last step lands exactly on the day or night level, however
        // small it is.
        const ending = level === DAY_LEVEL || level === this.night;
        if (stepped && this.level !== null && !ending && Math.abs(level - this.level) < FADE_STEP)
            return;
        this._setLevel(level);
        this._write();
    }

    _setLevel(level) {
        if (level === this.level)
            return;
        this.level = level;
        this.emit('level-changed', level);
    }

    _scheduleWrite() {
        if (this._writeId)
            GLib.source_remove(this._writeId);
        this._writeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._writeId = 0;
            this._write();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Sends the current level to each monitor, mapped onto its own range. */
    _write() {
        if (this.level === null)
            return;
        const config = this._monitorSettings();
        for (const monitor of this._monitors) {
            const {enabled = true, lowest = 0, highest = 100} = config[monitor.id] ?? {};
            if (!enabled || monitor.max === null)
                continue;
            const percent = lowest + (highest - lowest) * this.level / 100;
            monitor.set(Math.round(monitor.max * percent / 100));
        }
    }

    _scheduleDetect() {
        if (this._redetectId)
            GLib.source_remove(this._redetectId);
        this._redetectId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REDETECT_DELAY_SECONDS, () => {
            this._redetectId = 0;
            this._detect();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _detect() {
        // A detection that is overtaken by a newer one drops its result.
        const detection = ++this._detection;
        let monitors;
        try {
            monitors = await detect(this._cancellable);
            await Promise.all(monitors.map(monitor => monitor.read().catch(e => {
                console.warn(`Timely Brightness: could not read ${monitor.id}: ${e.message}`);
            })));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Timely Brightness: could not detect monitors: ${e.message}`);
            return;
        }
        if (detection !== this._detection)
            return;

        this._monitors = monitors;
        this._remember(monitors);

        if (this.auto)
            this._follow();
        else
            this._adoptMonitorLevel();
    }

    /** Adds newly seen monitors to the settings, so preferences can list them. */
    _remember(monitors) {
        const config = this._monitorSettings();
        let changed = false;
        for (const {id, model, connector} of monitors) {
            const known = config[id];
            if (known?.model === model && known?.connector === connector)
                continue;
            config[id] = {enabled: true, lowest: 0, highest: 100, ...known, model, connector};
            changed = true;
        }
        if (changed)
            this._settings.set_string('monitors', JSON.stringify(config));
    }

    /** With Auto off, the slider starts from what the first monitor shows. */
    _adoptMonitorLevel() {
        const config = this._monitorSettings();
        const monitor = this._monitors.find(m => m.value !== null && config[m.id]?.enabled !== false);
        if (!monitor)
            return;
        const {lowest = 0, highest = 100} = config[monitor.id] ?? {};
        const percent = 100 * monitor.value / monitor.max;
        const level = highest === lowest ? 100 : 100 * (percent - lowest) / (highest - lowest);
        this._setLevel(Math.clamp(level, 0, 100));
    }
}
