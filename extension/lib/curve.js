import {HORIZON, crossings, sunElevation} from './sun.js';

/** Sun elevation, in degrees, from which brightness stays at the day level: the end of the golden hour. */
export const DAY_ELEVATION = 6;

/** Sun elevation at which brightness is at the dusk level: sunrise and sunset. */
export const DUSK_ELEVATION = HORIZON;

/** Sun elevation below which brightness stays at the night level: the end of civil twilight. */
export const NIGHT_ELEVATION = -6;

/** Brightness, on the 0–100 scale, while the sun is well up. */
export const DAY_LEVEL = 100;

const SAMPLE_STEP_MS = 10 * 60 * 1000;

const lerp = (from, to, t) => from + (to - from) * t;

/**
 * Brightness (0–100) for a sun at `elevation` degrees. Around the horizon the
 * sun's elevation changes almost linearly with time, so blending linearly by
 * elevation gives even fades whose length follows the season.
 *
 * @param {number} elevation
 * @param {number} dusk - brightness at sunrise and sunset
 * @param {number} night - brightness once civil twilight has ended
 * @returns {number}
 */
export function levelAt(elevation, dusk, night) {
    if (elevation >= DAY_ELEVATION)
        return DAY_LEVEL;
    if (elevation >= DUSK_ELEVATION) {
        return lerp(dusk, DAY_LEVEL,
            (elevation - DUSK_ELEVATION) / (DAY_ELEVATION - DUSK_ELEVATION));
    }
    if (elevation >= NIGHT_ELEVATION) {
        return lerp(night, dusk,
            (elevation - NIGHT_ELEVATION) / (DUSK_ELEVATION - NIGHT_ELEVATION));
    }
    return night;
}

/**
 * The sun's path through the local calendar day containing `date`, for
 * drawing. `samples` includes the exact moments the sun crosses each
 * threshold, so a polyline through them has its corners in the right places.
 *
 * @param {Date} date
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{
 *   start: Date, end: Date,
 *   samples: {time: Date, elevation: number}[],
 *   duskTimes: Date[], nightTimes: Date[],
 *   darkSpans: [Date, Date][],
 * }}
 */
export function sunDay(date, latitude, longitude) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    // Not start + 24 h: days that change to or from summer time are 23 or 25 h long.
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const crossingsOf = elevation => crossings(start, end, latitude, longitude, elevation);
    const duskTimes = crossingsOf(DUSK_ELEVATION);
    const nightTimes = crossingsOf(NIGHT_ELEVATION);

    const times = [...crossingsOf(DAY_ELEVATION), ...duskTimes, ...nightTimes];
    for (let time = start.getTime(); time <= end.getTime(); time += SAMPLE_STEP_MS)
        times.push(new Date(time));
    times.push(end);
    times.sort((a, b) => a - b);

    const samples = times.map(time => ({time, elevation: sunElevation(time, latitude, longitude)}));

    const edges = [start, ...duskTimes, end];
    const darkSpans = [];
    for (let i = 0; i + 1 < edges.length; i++) {
        const middle = new Date((edges[i].getTime() + edges[i + 1].getTime()) / 2);
        if (sunElevation(middle, latitude, longitude) < DUSK_ELEVATION)
            darkSpans.push([edges[i], edges[i + 1]]);
    }

    return {start, end, samples, duskTimes, nightTimes, darkSpans};
}
