import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {levelAt} from './curve.js';

const PADDING = 8;
const LABEL_GAP = 4;
const HANDLE_RADIUS = 6;
const DRAGGED_HANDLE_RADIUS = 8;
const HOUR_MARKS = [6, 12, 18];

function setSource(cr, color, alpha = 1) {
    cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, alpha * color.alpha / 255);
}

/**
 * Today's brightness drawn against the clock, with handles at sunrise/sunset
 * (dusk) and at the end of civil twilight (night). Dragging a handle up or
 * down changes that level. A press anywhere picks the handle nearest in time,
 * since the graph has no other use for a press.
 *
 * Signals:
 * - `level-changed` (kind, level): a handle moved; `kind` is `dusk` or `night`.
 * - `drag-end`: the handle was let go. Read the levels from `levels`.
 */
export const DayGraph = GObject.registerClass({
    Signals: {
        'level-changed': {param_types: [GObject.TYPE_STRING, GObject.TYPE_DOUBLE]},
        'drag-end': {},
    },
}, class DayGraph extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'timely-brightness-graph',
            reactive: true,
            x_expand: true,
            accessible_name: _('Brightness through the day'),
        });

        this._day = null;
        this._now = new Date();
        /** The dusk and night levels drawn, 0–100. */
        this.levels = {dusk: 0, night: 0};
        this._dragging = null;
        this._grab = null;

        this._panGesture = new Clutter.PanGesture();
        this._panGesture.set_begin_threshold(0);
        this._panGesture.connect('recognize', () => this._startDrag());
        this._panGesture.connect('pan-update', () => this._drag());
        this._panGesture.connect('end', () => this._endDrag());
        this._panGesture.connect('cancel', () => this._endDrag());
        this.add_action(this._panGesture);
    }

    get dragging() {
        return this._dragging !== null;
    }

    /**
     * @param {ReturnType<import('./curve.js').sunDay>} day
     * @param {{dusk: number, night: number}} levels
     * @param {Date} now
     */
    update(day, levels, now) {
        this._day = day;
        this._now = now;
        if (!this.dragging)
            this.levels = {...levels};
        this.queue_repaint();
    }

    vfunc_style_changed() {
        super.vfunc_style_changed();
        this._curveColor = this.get_theme_node().get_color('-timely-curve-color');
    }

    _area() {
        // Not get_surface_size(): that only answers during a repaint, and
        // dragging needs the geometry too.
        const {width, height} = this;
        const labelHeight = this._labelHeight ?? 0;
        return {
            left: PADDING,
            right: width - PADDING,
            top: PADDING,
            bottom: height - PADDING - labelHeight - LABEL_GAP,
            height,
        };
    }

    _timeToX(time, area) {
        const {start, end} = this._day;
        return area.left + (area.right - area.left) * (time - start) / (end - start);
    }

    _levelToY(level, area) {
        return area.bottom - (area.bottom - area.top) * level / 100;
    }

    _yToLevel(y, area) {
        return Math.round(Math.clamp(100 * (area.bottom - y) / (area.bottom - area.top), 0, 100));
    }

    /** Where each handle sits in time. A polar day or night has no crossing, so its handle goes to the sun's lowest point. */
    _handles() {
        const {samples, duskTimes, nightTimes} = this._day;
        const lowest = samples.reduce((a, b) => (b.elevation < a.elevation ? b : a)).time;
        const at = (kind, times) => (times.length ? times : [lowest]).map(time => ({kind, time}));
        return [...at('dusk', duskTimes), ...at('night', nightTimes)];
    }

    _startDrag() {
        if (!this._day)
            return;
        const {x} = this._panGesture.get_centroid();
        const area = this._area();
        const distance = handle => Math.abs(this._timeToX(handle.time, area) - x);
        const nearest = this._handles().reduce((a, b) => (distance(b) < distance(a) ? b : a));

        this._grab = global.stage.grab(this);
        this._dragging = nearest.kind;
        this._drag();
    }

    _drag() {
        if (!this.dragging)
            return;
        const {y} = this._panGesture.get_centroid();
        const level = this._yToLevel(y, this._area());
        if (level === this.levels[this._dragging])
            return;
        this.levels = {...this.levels, [this._dragging]: level};
        this.queue_repaint();
        this.emit('level-changed', this._dragging, level);
    }

    _endDrag() {
        if (!this.dragging)
            return;
        this._grab?.dismiss();
        this._grab = null;
        this._dragging = null;
        this.queue_repaint();
        this.emit('drag-end');
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const themeNode = this.get_theme_node();
        const foreground = themeNode.get_foreground_color();

        const font = themeNode.get_font().copy();
        font.set_size(Math.round(font.get_size() * 0.8));
        const layout = PangoCairo.create_layout(cr);
        layout.set_font_description(font);
        layout.set_text('00', -1);
        this._labelHeight = layout.get_pixel_size()[1];

        if (!this._day) {
            cr.$dispose();
            return;
        }

        const area = this._area();
        const {dusk, night} = this.levels;
        const x = time => this._timeToX(time, area);
        const y = level => this._levelToY(level, area);

        for (const [from, to] of this._day.darkSpans) {
            cr.rectangle(x(from), area.top, x(to) - x(from), area.bottom - area.top);
            setSource(cr, foreground, 0.06);
            cr.fill();
        }

        cr.setLineWidth(1);
        setSource(cr, foreground, 0.15);
        for (const level of [0, 100]) {
            cr.moveTo(area.left, y(level) + 0.5);
            cr.lineTo(area.right, y(level) + 0.5);
        }
        cr.stroke();

        for (const hour of HOUR_MARKS) {
            const time = new Date(this._day.start);
            time.setHours(hour);
            layout.set_text(`${hour}`.padStart(2, '0'), -1);
            const [labelWidth] = layout.get_pixel_size();
            cr.moveTo(x(time) - labelWidth / 2, area.bottom + LABEL_GAP);
            setSource(cr, foreground, 0.6);
            PangoCairo.show_layout(cr, layout);
        }

        const points = this._day.samples.map(({time, elevation}) =>
            [x(time), y(levelAt(elevation, dusk, night))]);

        cr.moveTo(points[0][0], area.bottom);
        for (const [px, py] of points)
            cr.lineTo(px, py);
        cr.lineTo(points.at(-1)[0], area.bottom);
        cr.closePath();
        setSource(cr, this._curveColor, 0.25);
        cr.fill();

        cr.setLineWidth(2);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.moveTo(...points[0]);
        for (const point of points.slice(1))
            cr.lineTo(...point);
        setSource(cr, this._curveColor);
        cr.stroke();

        const nowX = Math.round(x(this._now)) + 0.5;
        cr.setLineWidth(1);
        cr.moveTo(nowX, area.top);
        cr.lineTo(nowX, area.bottom);
        setSource(cr, foreground, 0.5);
        cr.stroke();

        for (const {kind, time} of this._handles()) {
            const radius = kind === this._dragging ? DRAGGED_HANDLE_RADIUS : HANDLE_RADIUS;
            cr.arc(x(time), y(this.levels[kind]), radius, 0, 2 * Math.PI);
            setSource(cr, foreground);
            cr.fill();
        }

        cr.$dispose();
    }
});
