import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {rgba} from './color.js';
import {GlassLayer} from './glass.js';
import {MaximizeWatcher} from './maximizeWatcher.js';
import {Palette} from './palette.js';

const GLOW_SHADOW_ALPHA = 0.35;

// Styles the panel box and its three section boxes as islands. Everything is
// inline style, recomputed from settings and state in _restyle(), so St's
// transition-duration cross-fades every change (hover, merge, recolor).
//
// The panel itself is made transparent by the stylesheet instead: the overview
// owns Main.panel's inline style and resets it on every show and hide.
//
// The floating gap is padding on the panel box, never margin on the panel:
// the panel box's height is what the window strut is built from. Merging only
// recolors the panel box, so maximized windows never resize when it happens.
export class Islands {
    constructor(settings) {
        this._settings = settings;
        this._panelBox = Main.layoutManager.panelBox;
        this._boxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox];
        this._empty = new Map();
        this._original = new Map();
        this._watched = new Set();
        this._menus = new Map();

        this._palette = new Palette(() => this._restyle());
        this._maximize = new MaximizeWatcher(() => this._restyle());
        this._barGlass = new GlassLayer(this._panelBox);
        this._glass = new Map(this._boxes.map(box => [box, new GlassLayer(box)]));

        for (const box of this._boxes) {
            this._original.set(box, {reactive: box.reactive, trackHover: box.track_hover});
            box.reactive = true;
            box.track_hover = true;
            box.connectObject('notify::hover', () => this._restyle(), this);
            this._watchBox(box);
        }

        Main.panel.add_style_class_name('islandbar');
        settings.connectObject('changed', () => this._restyle(), this);
        Main.overview.connectObject(
            'showing', () => this._restyle(),
            'hidden', () => this._restyle(),
            this);
        this._panelBox.connectObject('notify::visible', () => this._restyle(), this);
        this._restyle();
    }

    destroy() {
        const menus = [...this._menus.keys()];
        for (const object of [this._settings, Main.overview, this._panelBox, ...this._boxes, ...this._watched, ...menus])
            object.disconnectObject(this);

        this._glass.forEach(layer => layer.destroy());
        this._barGlass.destroy();
        this._maximize.destroy();
        this._palette.destroy();

        for (const box of this._boxes) {
            const {reactive, trackHover} = this._original.get(box);
            box.reactive = reactive;
            box.track_hover = trackHover;
            box.set_style(null);
        }
        Main.panel.remove_style_class_name('islandbar');
        this._panelBox.set_style(null);
    }

    _watchBox(box) {
        box.connectObject(
            'child-added', (_box, child) => {
                this._watchChild(child);
                this._syncEmpty(box);
            },
            'child-removed', () => this._syncEmpty(box),
            this);
        box.get_children().forEach(child => this._watchChild(child));
        this._syncEmpty(box);
    }

    _watchChild(child) {
        if (this._watched.has(child))
            return;
        this._watched.add(child);
        child.connectObject(
            'notify::visible', () => this._boxes.forEach(box => this._syncEmpty(box)),
            'destroy', () => this._watched?.delete(child),
            this);

        // Panel indicators are wrapped in a container bin; the button inside
        // owns the menu whose open state lights its island up.
        const menu = child.get_first_child?.()?.menu;
        if (menu?.connectObject && !this._menus.has(menu)) {
            this._menus.set(menu, child);
            menu.connectObject('open-state-changed', () => this._restyle(), this);
        }
    }

    _syncEmpty(box) {
        const empty = !box.get_children().some(child => child.visible);
        if (this._empty.get(box) === empty)
            return;
        this._empty.set(box, empty);
        if (this._glass)
            this._restyle();
    }

    _menuOpenIn(box) {
        for (const [menu, child] of this._menus) {
            if (menu.isOpen && child.get_parent() === box)
                return true;
        }
        return false;
    }

    _restyle() {
        const settings = this._settings;
        const colors = this._palette.resolve(settings);
        const overview = Main.overview.visible;
        const merged = settings.get_boolean('merge-on-maximize') && this._maximize.maximized && !overview;

        const radius = settings.get_int('corner-radius');
        const gap = settings.get_int('gap');
        const borderWidth = settings.get_int('border-width');
        const blur = settings.get_boolean('blur');
        const shadow = settings.get_boolean('shadow');
        const glow = settings.get_boolean('hover-glow');
        const fill = rgba(colors.island, settings.get_double('island-opacity'));
        const edge = rgba(colors.border, settings.get_double('border-opacity'));
        const glass = {
            blurRadius: settings.get_int('blur-radius'),
            brightness: settings.get_double('blur-brightness'),
            shadow,
            base: rgba(colors.island, 1),
        };
        const showGlass = blur && !overview && this._panelBox.visible;

        this._panelBox.set_style(
            `padding: ${gap}px ${gap + 2}px 0 ${gap + 2}px; transition-duration: 250ms;` +
            (merged ? ` background-color: ${fill}; border-bottom: ${borderWidth}px solid ${edge};` : ''));
        this._barGlass.update({...glass, visible: showGlass && merged, radius: 0});

        for (const box of this._boxes) {
            const island = !merged && !this._empty.get(box);
            const hot = island && glow && (box.hover || this._menuOpenIn(box));

            let boxShadow = '';
            if (hot)
                boxShadow = ` box-shadow: 0 0 10px ${rgba(colors.accent, GLOW_SHADOW_ALPHA)};`;
            else if (island && shadow && !blur)
                boxShadow = ' box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);';

            box.set_style(island
                ? `background-color: ${fill}; border: ${borderWidth}px solid ${hot ? rgba(colors.accent, 0.85) : edge};` +
                  ` border-radius: ${radius}px; padding: 0 4px; transition-duration: 200ms;${boxShadow}`
                : `background-color: transparent; border-width: 0; border-radius: 0;` +
                  ` padding: 0 ${this._empty.get(box) ? 0 : 4}px; transition-duration: 250ms;`);

            this._glass.get(box).update({...glass, visible: showGlass && island, radius});
        }
    }
}
