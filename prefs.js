import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const toHex = color => `#${[color.red, color.green, color.blue]
    .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;

export default class IslandbarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = (title, description = null) => {
            const preferencesGroup = new Adw.PreferencesGroup({title, description});
            page.add(preferencesGroup);
            return preferencesGroup;
        };

        const toggle = (parent, key, title, subtitle = null) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            parent.add(row);
            return row;
        };

        const number = (parent, key, title, lower, upper, step, digits = 0) => {
            const row = new Adw.SpinRow({
                title,
                digits,
                adjustment: new Gtk.Adjustment({lower, upper, step_increment: step}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            parent.add(row);
            return row;
        };

        const color = (parent, key, title) => {
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: false}),
                valign: Gtk.Align.CENTER,
            });
            const load = () => {
                const rgba = new Gdk.RGBA();
                if (rgba.parse(settings.get_string(key)) && toHex(rgba) !== toHex(button.rgba))
                    button.rgba = rgba;
            };
            load();
            button.connect('notify::rgba', () => settings.set_string(key, toHex(button.rgba)));
            settings.connect(`changed::${key}`, load);

            const row = new Adw.ActionRow({title, activatable_widget: button});
            row.add_suffix(button);
            parent.add(row);
            return row;
        };

        const look = group('Islands');
        color(look, 'island-color', 'Fill color');
        number(look, 'island-opacity', 'Fill opacity', 0, 1, 0.05, 2);
        number(look, 'corner-radius', 'Corner radius', 0, 30, 1);
        number(look, 'gap', 'Gap from screen edge', 0, 24, 1);

        const border = group('Border');
        color(border, 'border-color', 'Border color');
        number(border, 'border-opacity', 'Border opacity', 0, 1, 0.05, 2);
        number(border, 'border-width', 'Border width', 0, 4, 1);

        const glass = group('Frosted glass');
        const blur = toggle(glass, 'blur', 'Blur the wallpaper behind the islands');
        const blurRadius = number(glass, 'blur-radius', 'Blur strength', 1, 40, 1);
        const brightness = number(glass, 'blur-brightness', 'Glass brightness', 0.2, 1, 0.05, 2);
        blur.bind_property('active', blurRadius, 'sensitive', 2 /* SYNC_CREATE */);
        blur.bind_property('active', brightness, 'sensitive', 2);

        const effects = group('Effects');
        toggle(effects, 'shadow', 'Drop shadow');
        const glow = toggle(effects, 'hover-glow', 'Glow on hover', 'Also while one of the island’s menus is open');
        const accent = color(effects, 'accent-color', 'Glow color');
        glow.bind_property('active', accent, 'sensitive', 2);
        const merge = toggle(effects, 'merge-on-maximize', 'Merge into a full bar when a window is maximized');
        const mergedOpacity = number(effects, 'merged-opacity', 'Merged bar opacity', 0, 1, 0.05, 2);
        merge.bind_property('active', mergedOpacity, 'sensitive', 2);

        const colors = group('Wallpaper colors',
            'Uses the palette rice-theme writes to ~/.cache/rice/islandbar.json. Overrides the colors above while on.');
        toggle(colors, 'wallpaper-colors', 'Match the wallpaper');

        const dynamic = group('Dynamic island');
        const media = toggle(dynamic, 'dynamic-island', 'Show the playing song next to the clock', 'Click it to play or pause');
        const notifications = toggle(dynamic, 'dynamic-island-notifications', 'Flash notification titles');
        media.bind_property('active', notifications, 'sensitive', 2);
    }
}
