import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Extra wallpaper blurred around the strip, so the blur near its edges
// samples real pixels instead of fading into transparency.
const BLUR_MARGIN = 40;

// Up to three rounded rectangles cut out of one blurred strip (signed
// distance, 1px antialiased edge). Everything is in texture pixels; a rect
// with zero width is skipped.
const MASK_SHADER = `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float radius;
uniform float x0; uniform float y0; uniform float w0; uniform float h0;
uniform float x1; uniform float y1; uniform float w1; uniform float h1;
uniform float x2; uniform float y2; uniform float w2; uniform float h2;

float roundedRect(vec2 p, float x, float y, float w, float h) {
    if (w < 1.0)
        return 0.0;
    vec2 half_size = vec2(w, h) * 0.5;
    float r = min(radius, min(half_size.x, half_size.y));
    vec2 q = abs(p - vec2(x, y) - half_size) - (half_size - vec2(r));
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    return clamp(0.5 - dist, 0.0, 1.0);
}

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].st;
    vec2 p = uv * vec2(width, height);
    float alpha = max(roundedRect(p, x0, y0, w0, h0),
                      max(roundedRect(p, x1, y1, w1, h1), roundedRect(p, x2, y2, w2, h2)));
    cogl_color_out = texture2D(tex, uv) * alpha;
}`;

const MAX_RECTS = 3;

// GJS turns integral Numbers into int GValues, which a float uniform rejects.
const asFloat = value => Number.isInteger(value) ? value + 1e-4 : value;

const MaskEffect = GObject.registerClass(
class IslandbarMaskEffect extends Clutter.ShaderEffect {
    constructor() {
        super();
        this.set_shader_source(MASK_SHADER);
        this.set_uniform_value('tex', 0);
    }

    // The offscreen texture covers the actor's clipped, pixel-aligned
    // allocation at its resource scale, rounded up. Rects are logical pixels
    // relative to the actor.
    setGeometry(width, height, radius, rects, scale) {
        this.set_uniform_value('width', asFloat(Math.ceil(width * scale)));
        this.set_uniform_value('height', asFloat(Math.ceil(height * scale)));
        this.set_uniform_value('radius', asFloat(radius * scale));
        for (let i = 0; i < MAX_RECTS; i++) {
            const [x, y, w, h] = rects[i] ?? [0, 0, 0, 0];
            this.set_uniform_value(`x${i}`, asFloat(x * scale));
            this.set_uniform_value(`y${i}`, asFloat(y * scale));
            this.set_uniform_value(`w${i}`, asFloat(w * scale));
            this.set_uniform_value(`h${i}`, asFloat(h * scale));
        }
    }
});

// Frosted glass under the islands: one clone of the background group (which
// holds Hanabi's video too) across the panel box, blurred once and masked to
// the visible islands. Blurring per island cost a full blur pass each, every
// frame of a video wallpaper; one shared pass costs about as much as one.
//
// Each island also gets a plain base plate underneath, carrying the drop
// shadow and an opaque island-colored fill so the mask's antialiased edge
// blends into island color instead of whatever is below.
export class GlassStrip {
    constructor(panelBox, boxes) {
        this._panelBox = panelBox;
        this._boxes = boxes;
        this._targets = [];
        this._radius = 0;

        const uiGroup = Main.layoutManager.uiGroup;
        this._bases = boxes.map(() => {
            const base = new St.Widget({visible: false});
            uiGroup.insert_child_below(base, panelBox);
            return base;
        });

        this._frame = new St.Widget({visible: false, clip_to_allocation: true});
        this._mask = new MaskEffect();
        this._frame.add_effect(this._mask);
        this._blurHost = new Clutter.Actor({clip_to_allocation: true});
        this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR});
        this._blurHost.add_effect(this._blur);
        this._clone = new Clutter.Clone({source: Main.layoutManager._backgroundGroup});
        this._blurHost.add_child(this._clone);
        this._frame.add_child(this._blurHost);
        uiGroup.insert_child_below(this._frame, panelBox);

        for (const actor of [panelBox, ...boxes])
            actor.connectObject('notify::allocation', () => this._queueSync(), this);
    }

    destroy() {
        if (this._laterId)
            global.compositor.get_laters().remove(this._laterId);
        for (const actor of [this._panelBox, ...this._boxes])
            actor.disconnectObject(this);
        this._bases.forEach(base => base.destroy());
        this._frame.destroy();
        this._frame = null;
    }

    // targets: the actors (islands, or the whole panel box when merged) to
    // put glass under; an empty list hides the glass and stops its painting.
    update({targets, radius, blurRadius, brightness, shadow, base}) {
        this._targets = targets;
        this._radius = radius;
        this._blur.radius = blurRadius;
        this._blur.brightness = brightness;

        const style = `border-radius: ${radius}px; background-color: ${base};` +
            (shadow ? ' box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);' : '');
        this._bases.forEach(plate => plate.set_style(style));

        const visible = targets.length > 0;
        this._frame.visible = visible;
        if (!visible)
            this._bases.forEach(plate => (plate.visible = false));
        else
            this._queueSync();
    }

    _queueSync() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        if (!this._frame.visible)
            return;

        const [x, y] = this._panelBox.get_transformed_position().map(Math.round);
        const [width, height] = this._panelBox.get_transformed_size().map(Math.round);
        if (!width || !height)
            return;

        this._frame.set_position(x, y);
        this._frame.set_size(width, height);
        this._blurHost.set_position(-BLUR_MARGIN, -BLUR_MARGIN);
        this._blurHost.set_size(width + 2 * BLUR_MARGIN, height + 2 * BLUR_MARGIN);
        this._clone.set_position(BLUR_MARGIN - x, BLUR_MARGIN - y);

        const rects = this._targets.slice(0, MAX_RECTS).map(target => {
            const [tx, ty] = target.get_transformed_position().map(Math.round);
            const [tw, th] = target.get_transformed_size().map(Math.round);
            return [tx, ty, tw, th];
        });
        this._bases.forEach((plate, i) => {
            const rect = rects[i];
            plate.visible = !!rect;
            if (rect) {
                plate.set_position(rect[0], rect[1]);
                plate.set_size(rect[2], rect[3]);
            }
        });
        this._mask.setGeometry(width, height, this._radius,
            rects.map(([tx, ty, tw, th]) => [tx - x, ty - y, tw, th]),
            this._frame.get_resource_scale());
    }
}
