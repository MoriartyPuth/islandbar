import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Extra wallpaper blurred around each island, so the blur near the island's
// edges samples real pixels instead of fading into transparency.
const BLUR_MARGIN = 40;

// Rounded-rectangle mask (signed distance, 1px antialiased edge) over the
// offscreen texture. Sizes come in texture pixels, set at paint time.
const CORNER_SHADER = `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float radius;

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].st;
    vec2 size = vec2(width, height);
    vec2 center = size * 0.5;
    vec2 q = abs(uv * size - center) - (center - vec2(radius));
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    cogl_color_out = texture2D(tex, uv) * clamp(0.5 - dist, 0.0, 1.0);
}`;

// GJS turns integral Numbers into int GValues, which a float uniform rejects.
const asFloat = value => Number.isInteger(value) ? value + 1e-4 : value;

const CornerEffect = GObject.registerClass(
class IslandbarCornerEffect extends Clutter.ShaderEffect {
    constructor() {
        super();
        this.radius = 0;
        this.set_shader_source(CORNER_SHADER);
    }

    vfunc_paint_target(node, paintContext) {
        // The offscreen texture is the actor's clipped allocation at its
        // resource scale, so measure it rather than predicting it.
        const texture = this.get_texture();
        if (texture) {
            const scale = this.get_actor().get_resource_scale();
            this.set_uniform_value('tex', 0);
            this.set_uniform_value('width', asFloat(texture.get_width()));
            this.set_uniform_value('height', asFloat(texture.get_height()));
            this.set_uniform_value('radius', asFloat(this.radius * scale));
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

// A frosted-glass plate that sits under one target actor: a clone of the
// background group (which holds Hanabi's video too) cropped to the target,
// blurred, masked to rounded corners, with an optional drop shadow.
export class GlassLayer {
    constructor(target) {
        this._target = target;

        this._frame = new St.Widget({visible: false});
        this._clip = new St.Widget({clip_to_allocation: true});
        this._corner = new CornerEffect();
        this._clip.add_effect(this._corner);

        this._blurHost = new Clutter.Actor({clip_to_allocation: true});
        this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR});
        this._blurHost.add_effect(this._blur);
        this._clone = new Clutter.Clone({source: Main.layoutManager._backgroundGroup});

        this._blurHost.add_child(this._clone);
        this._clip.add_child(this._blurHost);
        this._frame.add_child(this._clip);
        Main.layoutManager.uiGroup.insert_child_below(this._frame, Main.layoutManager.panelBox);

        target.connectObject('notify::allocation', () => this._queueSync(), this);
    }

    destroy() {
        if (this._laterId)
            global.compositor.get_laters().remove(this._laterId);
        this._target.disconnectObject(this);
        this._frame.destroy();
        this._frame = null;
    }

    update({visible, radius, blurRadius, brightness, shadow, base}) {
        // The frame's own fill matches the island so the mask's antialiased
        // edge blends into island color instead of whatever is underneath.
        this._frame.set_style(
            `border-radius: ${radius}px; background-color: ${base};` +
            (shadow ? ' box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);' : ''));
        this._corner.radius = radius;
        this._blur.radius = blurRadius;
        this._blur.brightness = brightness;
        this._clip.queue_redraw();

        this._frame.visible = visible;
        if (visible)
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
        const [x, y] = this._target.get_transformed_position().map(Math.round);
        const [width, height] = this._target.get_transformed_size().map(Math.round);
        if (!width || !height)
            return;

        this._frame.set_position(x, y);
        this._frame.set_size(width, height);
        this._clip.set_size(width, height);
        this._blurHost.set_position(-BLUR_MARGIN, -BLUR_MARGIN);
        this._blurHost.set_size(width + 2 * BLUR_MARGIN, height + 2 * BLUR_MARGIN);
        this._clone.set_position(BLUR_MARGIN - x, BLUR_MARGIN - y);
    }
}
