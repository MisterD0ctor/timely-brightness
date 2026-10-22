import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {HORIZON, crossings} from './lib/sun.js';

function parseMonitors(settings) {
    try {
        return JSON.parse(settings.get_string('monitors'));
    } catch {
        return {};
    }
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
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            const times = crossings(start, end,
                settings.get_double('latitude'), settings.get_double('longitude'), HORIZON);
            today.subtitle = times.length === 2
                ? _('Sunrise %s · Sunset %s').format(format(times[0]), format(times[1]))
                : _('The sun neither rises nor sets today');
        };
        watch('changed::latitude', showToday);
        watch('changed::longitude', showToday);
        showToday();

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
