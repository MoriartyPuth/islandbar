import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Tracks whether a normal window is maximized on the primary monitor's active
// workspace (the one the top bar sits on) and calls back when that flips.
export class MaximizeWatcher {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._windows = new Set();

        global.display.connectObject('window-created', (_display, window) => this._watch(window), this);
        global.workspace_manager.connectObject('active-workspace-changed', () => this._queueUpdate(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._queueUpdate(), this);
        global.get_window_actors().forEach(actor => this._watch(actor.meta_window));

        this.maximized = this._compute();
    }

    destroy() {
        if (this._laterId)
            global.compositor.get_laters().remove(this._laterId);
        for (const object of [global.display, global.workspace_manager, Main.layoutManager, ...this._windows])
            object.disconnectObject(this);
        this._windows = null;
    }

    _watch(window) {
        this._windows.add(window);
        window.connectObject(
            'notify::maximized-vertically', () => this._queueUpdate(),
            'notify::minimized', () => this._queueUpdate(),
            'workspace-changed', () => this._queueUpdate(),
            'unmanaged', () => {
                window.disconnectObject(this);
                this._windows.delete(window);
                this._queueUpdate();
            },
            this);
        this._queueUpdate();
    }

    _queueUpdate() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            const maximized = this._compute();
            if (maximized !== this.maximized) {
                this.maximized = maximized;
                this._onChanged(maximized);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _compute() {
        const workspace = global.workspace_manager.get_active_workspace();
        const primary = Main.layoutManager.primaryIndex;
        return [...this._windows].some(window =>
            window.maximized_vertically &&
            !window.minimized &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            window.get_monitor() === primary &&
            window.located_on_workspace(workspace));
    }
}
