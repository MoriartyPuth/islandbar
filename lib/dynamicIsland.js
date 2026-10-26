import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {MprisSource} from 'resource:///org/gnome/shell/ui/mpris.js';

const EASE_MS = 250;
const NOTIFICATION_MS = 3500;

// MprisSource never tears down its D-Bus proxies, so share one per shell
// session instead of leaking a new one on every enable (e.g. each unlock).
let mprisSource = null;

// A pill segment after the clock that stretches open for the playing song
// (click to play/pause) and briefly for notification titles.
export const DynamicIsland = GObject.registerClass(
class IslandbarDynamicIsland extends St.Button {
    constructor(settings) {
        super({
            style_class: 'panel-button islandbar-dynamic',
            y_align: Clutter.ActorAlign.FILL,
            clip_to_allocation: true,
            visible: false,
        });
        this._settings = settings;
        this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._flashId = 0;

        const box = new St.BoxLayout({style_class: 'islandbar-dynamic-box'});
        this._icon = new St.Icon({style_class: 'islandbar-dynamic-icon', y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'islandbar-dynamic-label', y_align: Clutter.ActorAlign.CENTER});
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._icon);
        box.add_child(this._label);
        this.set_child(box);
        this.connect('clicked', () => this._activePlayer()?.playPause());
        this.connect('destroy', () => {
            if (this._flashId)
                GLib.source_remove(this._flashId);
        });

        mprisSource ??= new MprisSource();
        mprisSource.connectObject(
            'player-added', (_source, player) => this._watchPlayer(player),
            'player-removed', (_source, player) => {
                player.disconnectObject(this);
                this._sync();
            },
            this);
        mprisSource.players.forEach(player => this._watchPlayer(player));

        Main.messageTray.connectObject('source-added', (_tray, source) => this._watchSource(source), this);
        Main.messageTray.getSources().forEach(source => this._watchSource(source));

        Main.panel._centerBox.add_child(this);
        this._sync();
    }

    _watchPlayer(player) {
        player.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    _watchSource(source) {
        source.connectObject('notification-added', (_source, notification) => this._flash(notification), this);
    }

    _activePlayer() {
        const players = mprisSource.players.filter(player => player.trackTitle);
        return players.find(player => player.status === 'Playing') ??
            players.find(player => player.status === 'Paused');
    }

    _flash(notification) {
        if (!this._settings.get_boolean('dynamic-island-notifications') ||
            !this._notificationSettings.get_boolean('show-banners') ||
            !notification.title)
            return;

        if (this._flashId)
            GLib.source_remove(this._flashId);
        this._flashId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, NOTIFICATION_MS, () => {
            this._flashId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
        this._open('preferences-system-notifications-symbolic', notification.title);
    }

    _sync() {
        if (this._flashId)
            return;

        const player = this._activePlayer();
        if (!player) {
            this._close();
            return;
        }
        const artists = player.trackArtists.filter(Boolean).join(', ');
        this._open(
            player.status === 'Playing' ? 'audio-x-generic-symbolic' : 'media-playback-pause-symbolic',
            artists ? `${player.trackTitle} — ${artists}` : player.trackTitle);
    }

    // Animate the width from wherever it is now to the new content's natural
    // width; the max-width in the stylesheet caps long titles (they ellipsize).
    _open(iconName, text) {
        this._icon.icon_name = iconName;
        this._label.text = text;

        if (!this.visible) {
            this.set_width(0);
            this.opacity = 0;
            this.visible = true;
        }
        const from = this.width;
        this.set_width(-1);
        const [, natural] = this.get_preferred_width(-1);
        this.set_width(from);

        this.remove_all_transitions();
        this.ease({
            width: natural,
            opacity: 255,
            duration: EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.set_width(-1),
        });
    }

    _close() {
        if (!this.visible)
            return;
        this.set_width(this.width);
        this.remove_all_transitions();
        this.ease({
            width: 0,
            opacity: 0,
            duration: EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.visible = false;
                this.set_width(-1);
            },
        });
    }
});
