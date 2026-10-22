import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {DayGraph} from './graph.js';

const ICON_NAME = 'display-brightness-symbolic';

/** The top bar button and its menu: the day graph, a brightness slider and the Auto switch. */
export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    /**
     * @param {import('./controller.js').Controller} controller
     * @param {() => void} openPreferences
     */
    _init(controller, openPreferences) {
        super._init(0.5, _('Timely Brightness'));
        this._controller = controller;
        // Set while the menu is being brought in line with the controller, so
        // the widgets' change signals aren't taken for the user's input.
        this._syncing = false;

        this.add_child(new St.Icon({icon_name: ICON_NAME, style_class: 'system-status-icon'}));

        this._graph = new DayGraph();
        this._graph.connect('level-changed', () => this._syncCaption());
        this._graph.connect('drag-end', () => controller.setLevels(this._graph.levels));
        const graphItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        graphItem.add_child(this._graph);
        this.menu.addMenuItem(graphItem);

        this._duskLabel = new St.Label({x_expand: true});
        this._nightLabel = new St.Label();
        const captionItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'timely-brightness-caption',
        });
        captionItem.add_child(this._duskLabel);
        captionItem.add_child(this._nightLabel);
        this.menu.addMenuItem(captionItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._slider = new Slider(0);
        this._slider.accessible_name = _('Brightness');
        this._slider.connect('notify::value', () => {
            if (!this._syncing)
                controller.setManualLevel(100 * this._slider.value);
        });
        const sliderItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        sliderItem.add_child(new St.Icon({icon_name: ICON_NAME, style_class: 'popup-menu-icon'}));
        sliderItem.add_child(new St.Bin({
            style_class: 'slider-bin',
            child: this._slider,
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.menu.addMenuItem(sliderItem);

        this._autoItem = new PopupMenu.PopupSwitchMenuItem('', controller.auto);
        this._autoItem.connect('toggled', (_item, state) => {
            if (!this._syncing)
                controller.setAuto(state);
        });
        this.menu.addMenuItem(this._autoItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Settings'), openPreferences);

        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._syncGraph();
        }, this);
        controller.connectObject(
            'level-changed', () => this._syncLevel(),
            'changed', () => this._sync(),
            this);

        this._sync();
        this._syncLevel();
    }

    _sync() {
        const {auto, resumeAt} = this._controller;
        this._syncing = true;
        this._autoItem.setToggleState(auto);
        this._syncing = false;
        this._autoItem.label.text = !auto && resumeAt
            ? _('Follow the sun from %s').format(formatTime(resumeAt, {timeOnly: true}))
            : _('Follow the sun');

        if (this.menu.isOpen)
            this._syncGraph();
    }

    _syncLevel() {
        const {level} = this._controller;
        if (level !== null) {
            this._syncing = true;
            this._slider.value = level / 100;
            this._syncing = false;
        }

        if (this.menu.isOpen)
            this._syncGraph();
    }

    _syncGraph() {
        const {dusk, night} = this._controller;
        this._day = this._controller.sunDay();
        this._graph.update(this._day, {dusk, night}, new Date());
        this._syncCaption();
    }

    _syncCaption() {
        if (!this._day)
            return;
        const {dusk, night} = this._graph.levels;
        const withTime = (text, time) => (time ? `${text} · ${formatTime(time, {timeOnly: true})}` : text);
        this._duskLabel.text = withTime(_('Dusk %d%%').format(dusk), this._day.duskTimes.at(-1));
        this._nightLabel.text = withTime(_('Night %d%%').format(night), this._day.nightTimes.at(-1));
    }
});
