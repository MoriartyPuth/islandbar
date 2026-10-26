import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Written by the matugen 'islandbar' template whenever rice-theme runs:
// {"surface": "#...", "outline": "#...", "primary": "#..."}
const PALETTE_PATH = GLib.build_filenamev([GLib.get_user_cache_dir(), 'rice', 'islandbar.json']);

export class Palette {
    constructor(onChanged) {
        this._file = Gio.File.new_for_path(PALETTE_PATH);
        this._monitor = this._file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connectObject('changed', () => {
            this._load();
            onChanged();
        }, this);
        this._load();
    }

    destroy() {
        this._monitor.disconnectObject(this);
        this._monitor.cancel();
        this._monitor = null;
    }

    // The island, border and accent colors to draw with right now.
    resolve(settings) {
        const own = {
            island: settings.get_string('island-color'),
            border: settings.get_string('border-color'),
            accent: settings.get_string('accent-color'),
        };
        if (!settings.get_boolean('wallpaper-colors') || !this._colors)
            return own;

        return {
            island: this._colors.surface ?? own.island,
            border: this._colors.outline ?? own.border,
            accent: this._colors.primary ?? own.accent,
        };
    }

    _load() {
        try {
            const [, bytes] = this._file.load_contents(null);
            this._colors = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            this._colors = null;
        }
    }
}
