import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SunClock} from './lib/clock.js';
import {HORIZON, crossings} from './lib/sun.js';

function parseMonitors(settings) {
    try {
        return JSON.parse(settings.get_string('monitors'));
    } catch {
        return {};
    }
}

function timeSpin(upper, step, value) {
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({lower: 0, upper, step_increment: step, page_increment: 3 * step, value}),
        numeric: true,
        wrap: true,
    });
    // So that times read 07:05, not 7:5.
    spin.connect('output', () => {
        spin.set_text(String(spin.get_value_as_int()).padStart(2, '0'));
        return true;
    });
    return spin;
}

/** A row editing a setting held as minutes after midnight. */
function timeRow(title, subtitle, settings, key) {
    const minutes = settings.get_int(key);
    const hours = timeSpin(23, 1, Math.floor(minutes / 60));
    const mins = timeSpin(59, 5, minutes % 60);
    const save = () => settings.set_int(key, 60 * hours.get_value_as_int() + mins.get_value_as_int());
    hours.connect('value-changed', save);
    mins.connect('value-changed', save);

    const box = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
    box.append(hours);
    box.append(new Gtk.Label({label: ':'}));
    box.append(mins);

    const row = new Adw.ActionRow({title, subtitle});
    row.add_suffix(box);
    return row;
}

function spinRow(title, subtitle, lower, upper, digits) {
    return new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: digits ? 0.01 : 1,
            page_increment: digits ? 1 : 10,
        }),
    });
}

export default class TimelyBrightnessPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const handlerIds = [];
        const watch = (signal, callback) => handlerIds.push(settings.connect(signal, callback));
        window.connect('close-request', () => handlerIds.forEach(id => settings.disconnect(id)));

        const page = new Adw.PreferencesPage();
        page.add(this._locationGroup(settings, watch));
        page.add(this._rhythmGroup(settings));
        page.add(this._monitorsGroup(settings, watch));
        window.add(page);
    }

    _locationGroup(settings, watch) {
        const group = new Adw.PreferencesGroup({
            title: _('Location'),
            description: _('Sunrise and sunset are worked out from these coordinates, on this computer.'),
        });

        const latitude = spinRow(_('Latitude'), _('Degrees north; south is negative'), -90, 90, 2);
        const longitude = spinRow(_('Longitude'), _('Degrees east; west is negative'), -180, 180, 2);
        settings.bind('latitude', latitude, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('longitude', longitude, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(latitude);
        group.add(longitude);

        const today = new Adw.ActionRow({title: _('Today')});
        group.add(today);

        const clockFormat = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_string('clock-format');
        const format = date => GLib.DateTime.new_from_unix_local(Math.floor(date / 1000))
            .format(clockFormat === '12h' ? '%l:%M %p' : '%R').trim();

        const showToday = () => {
            const now = new Date();
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            const location = [settings.get_double('latitude'), settings.get_double('longitude')];
            const times = crossings(start, end, ...location, HORIZON);
            if (times.length !== 2) {
                today.subtitle = _('The sun neither rises nor sets today');
                return;
            }

            const weight = settings.get_int('rhythm-weight') / 100;
            const clock = new SunClock(now, ...location, {
                morning: settings.get_int('morning-time'),
                evening: settings.get_int('evening-time'),
                weight,
            });
            const show = time => (weight
                ? `${format(time)} → ${format(clock.toClock(time))}`
                : format(time));
            today.subtitle = _('Sunrise %s · Sunset %s').format(show(times[0]), show(times[1]));
        };
        for (const key of ['latitude', 'longitude', 'morning-time', 'evening-time', 'rhythm-weight'])
            watch(`changed::${key}`, showToday);
        showToday();

        return group;
    }

    _rhythmGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Daily Rhythm'),
            description: _('Sunrise and sunset are pulled toward these times, so screens stay bright ' +
                'through winter afternoons and dim in good time on summer evenings.'),
        });

        group.add(timeRow(_('Morning'), _('Sunrise is pulled toward this time'), settings, 'morning-time'));
        group.add(timeRow(_('Evening'), _('Sunset is pulled toward this time'), settings, 'evening-time'));

        const weight = spinRow(_('Weight'), _('0 % follows the sun; 100 % keeps to these times'), 0, 100, 0);
        settings.bind('rhythm-weight', weight, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(weight);

        return group;
    }

    _monitorsGroup(settings, watch) {
        const group = new Adw.PreferencesGroup({
            title: _('Monitors'),
            description: _('Brightness levels are spread over each monitor’s range from Lowest, at 0, to Highest, at 100.'),
        });

        let rows = [];
        let shownIds = '';
        const showMonitors = () => {
            const monitors = parseMonitors(settings);
            // Rebuilding on every change would drop the focus of a row being
            // edited, since each edit writes this same setting.
            const ids = Object.keys(monitors).sort().join('\n');
            if (ids === shownIds && rows.length)
                return;
            shownIds = ids;

            rows.forEach(row => group.remove(row));
            rows = Object.entries(monitors).map(([id, monitor]) => this._monitorRow(settings, id, monitor));
            if (!rows.length) {
                rows.push(new Adw.ActionRow({
                    title: _('No monitors found yet'),
                    subtitle: _('Monitors appear here once the extension has found them. ' +
                        'If one is missing, check that DDC/CI is on in its own menu.'),
                }));
            }
            rows.forEach(row => group.add(row));
        };
        watch('changed::monitors', showMonitors);
        showMonitors();

        return group;
    }

    _monitorRow(settings, id, monitor) {
        const update = change => {
            const monitors = parseMonitors(settings);
            monitors[id] = {...monitors[id], ...change};
            settings.set_string('monitors', JSON.stringify(monitors));
        };

        const row = new Adw.ExpanderRow({
            title: monitor.model ?? id,
            subtitle: monitor.connector ?? '',
            show_enable_switch: true,
            enable_expansion: monitor.enabled ?? true,
        });
        row.connect('notify::enable-expansion', () => update({enabled: row.enable_expansion}));

        const highest = spinRow(_('Highest'), _('Brightness in daylight, in percent of the monitor’s range'), 0, 100, 0);
        highest.value = monitor.highest ?? 100;
        highest.connect('notify::value', () => update({highest: highest.value}));
        row.add_row(highest);

        const lowest = spinRow(_('Lowest'), _('Brightness at level 0'), 0, 100, 0);
        lowest.value = monitor.lowest ?? 0;
        lowest.connect('notify::value', () => update({lowest: lowest.value}));
        row.add_row(lowest);

        return row;
    }
}
