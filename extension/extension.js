import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Controller} from './lib/controller.js';
import {Indicator} from './lib/indicator.js';

export default class TimelyBrightnessExtension extends Extension {
    enable() {
        this._controller = new Controller(this.getSettings());
        this._indicator = new Indicator(this._controller, () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._controller.destroy();
        this._controller = null;
    }
}
