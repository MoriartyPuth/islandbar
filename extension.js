import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DynamicIsland} from './lib/dynamicIsland.js';
import {Islands} from './lib/islands.js';

export default class IslandbarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._islands = new Islands(this._settings);

        this._settings.connectObject('changed::dynamic-island', () => this._syncDynamicIsland(), this);
        this._syncDynamicIsland();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._dynamicIsland?.destroy();
        this._dynamicIsland = null;
        this._islands.destroy();
        this._islands = null;
        this._settings = null;
    }

    _syncDynamicIsland() {
        const wanted = this._settings.get_boolean('dynamic-island');
        if (wanted && !this._dynamicIsland) {
            this._dynamicIsland = new DynamicIsland(this._settings);
        } else if (!wanted && this._dynamicIsland) {
            this._dynamicIsland.destroy();
            this._dynamicIsland = null;
        }
    }
}
