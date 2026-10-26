import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SLIDE_MS = 200;
const HIDE_DELAY_MS = 600;

// Slides the panel box off the top of the screen while active, and drops its
// strut so maximized windows take the full height. Touching the top edge of
// the primary monitor, or opening the overview, slides it back over the
// window until the pointer leaves it and no panel menu is open.
export class AutoHide {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._panelBox = Main.layoutManager.panelBox;
        this._original = {reactive: this._panelBox.reactive, trackHover: this._panelBox.track_hover};
        this._hideId = 0;
        this.active = false;
        this.revealed = true;

        this._edge = new Clutter.Actor({reactive: true, visible: false});
        Main.layoutManager.addChrome(this._edge);
        this._edge.connect('enter-event', () => this._reveal());

        this._panelBox.reactive = true;
        this._panelBox.track_hover = true;
        this._panelBox.connectObject(
            'notify::hover', () => this._queueHide(),
            // Keep a hidden bar fully off screen when its height changes
            // (e.g. the gap setting, or restyling right after enable).
            'notify::height', () => {
                if (this.active && !this.revealed && !this._panelBox.get_transition('translation-y'))
                    this._panelBox.translation_y = -this._panelBox.height;
            },
            this);
        Main.overview.connectObject(
            'showing', () => this._reveal(),
            'hidden', () => this._queueHide(),
            this);
        Main.layoutManager.connectObject('monitors-changed', () => this._placeEdge(), this);
        this._placeEdge();
    }

    destroy() {
        this._onChanged = () => {};
        this.setActive(false);
        this._panelBox.remove_transition('translation-y');
        this._panelBox.translation_y = 0;
        Main.overview.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._panelBox.disconnectObject(this);
        this._panelBox.reactive = this._original.reactive;
        this._panelBox.track_hover = this._original.trackHover;
        this._edge.destroy();
    }

    setActive(active) {
        if (active === this.active)
            return;
        this.active = active;

        // The strut is measured from the bar's on-screen position, so put it
        // back in place before re-tracking it with a strut; sliding it in
        // would let a mid-slide position leak into the work area.
        if (!active) {
            if (this._hideId) {
                GLib.source_remove(this._hideId);
                this._hideId = 0;
            }
            this._panelBox.remove_transition('translation-y');
            this._panelBox.translation_y = 0;
            this._edge.visible = false;
            this.revealed = true;
        }

        // Re-track the panel box with or without its strut, keeping the
        // fullscreen tracking GNOME gives it.
        Main.layoutManager.untrackChrome(this._panelBox);
        Main.layoutManager.trackChrome(this._panelBox, {affectsStruts: !active, trackFullscreen: true});

        if (active)
            this._slide(Main.overview.visible);
        this._onChanged();
    }

    _placeEdge() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._edge.set_position(monitor.x, monitor.y);
        this._edge.set_size(monitor.width, 1);
    }

    _reveal() {
        if (this.active)
            this._slide(true);
    }

    // Hide again once nothing is holding the bar open; re-checks while a
    // panel menu is open or the pointer is on the bar.
    _queueHide() {
        if (!this.active || this._hideId)
            return;
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            if (!this.active) {
                this._hideId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (this._panelBox.hover || Main.panel.menuManager.activeMenu || Main.overview.visible)
                return GLib.SOURCE_CONTINUE;
            this._hideId = 0;
            this._slide(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _slide(revealed) {
        if (!revealed && this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }
        this._edge.visible = this.active && !revealed;
        if (revealed === this.revealed)
            return;
        this.revealed = revealed;
        this._panelBox.ease({
            translation_y: revealed ? 0 : -this._panelBox.height,
            duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this.revealed)
                    this._panelBox.translation_y = -this._panelBox.height;
            },
        });
        if (revealed && this.active)
            this._queueHide();
        this._onChanged();
    }
}
