import {HORIZON, crossings, sunElevation} from './sun.js';

const DAY_MS = 86400000;
const MINUTE_MS = 60000;

/**
 * Maps clock time to sun time: the moment whose sun brightness follows. Each
 * sunrise is pulled toward the morning time and each sunset toward the evening
 * time, by `weight`. The time between two of them is stretched or squeezed
 * evenly, so a fade keeps its shape but moves.
 *
 * At this latitude the sun alone dims screens mid-afternoon in winter and keeps
 * them bright toward midnight in summer, both against a steady body clock.
 */
export class SunClock {
    /**
     * @param {Date} around - the mapping holds for at least a day either side
     * @param {number} latitude
     * @param {number} longitude
     * @param {object} rhythm
     * @param {number} rhythm.morning - minutes after midnight
     * @param {number} rhythm.evening - minutes after midnight
     * @param {number} rhythm.weight - 0 follows the sun, 1 the set times
     */
    constructor(around, latitude, longitude, {morning, evening, weight}) {
        const from = new Date(around.getTime() - 2 * DAY_MS);
        const until = new Date(around.getTime() + 2 * DAY_MS);
        this._anchors = crossings(from, until, latitude, longitude, HORIZON).map(sun => {
            const rising = sunElevation(new Date(sun.getTime() + MINUTE_MS), latitude, longitude) > HORIZON;
            const target = new Date(sun);
            target.setHours(0, rising ? morning : evening, 0, 0);
            return {sun: sun.getTime(), clock: sun.getTime() + weight * (target - sun)};
        });

        // Near the polar circles a sunset can fall after the next morning
        // time, which would run the clock backwards; there the sun is
        // followed as it is.
        if (this._anchors.some((anchor, i) => i > 0 && anchor.clock <= this._anchors[i - 1].clock))
            this._anchors = [];
    }

    /** @param {Date} clock @returns {Date} */
    toSun(clock) {
        return new Date(interpolate(this._anchors, 'clock', 'sun', clock.getTime()));
    }

    /** @param {Date} sun @returns {Date} */
    toClock(sun) {
        return new Date(interpolate(this._anchors, 'sun', 'clock', sun.getTime()));
    }

    /**
     * The first sunrise or sunset after `date`, as moved toward the set
     * times, or null in a polar day or night.
     *
     * @param {Date} date
     * @returns {Date | null}
     */
    nextChange(date) {
        const anchor = this._anchors.find(a => a.clock > date.getTime());
        return anchor ? new Date(anchor.clock) : null;
    }
}

function interpolate(anchors, from, to, time) {
    const next = anchors.findIndex(anchor => anchor[from] > time);
    // Outside the outermost sunrise and sunset, or with none at all, there is
    // nothing to pull toward.
    if (next <= 0)
        return time;
    const a = anchors[next - 1], b = anchors[next];
    return a[to] + (time - a[from]) * (b[to] - a[to]) / (b[from] - a[from]);
}
