// Solar position from the Astronomical Almanac's low-precision formulas. They
// are good to about 0.01° this century, far finer than brightness needs, and
// keep the extension free of network lookups.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const UNIX_EPOCH_TO_J2000_DAYS = 10957.5;

/** The elevation published sunrise and sunset times refer to: the sun's upper edge on the horizon, after refraction. */
export const HORIZON = -0.833;

// A dip below a threshold and back up within one step goes unnoticed. That
// only happens near the polar circles, for a few days a year.
const SEARCH_STEP_MS = 10 * 60 * 1000;

/**
 * The sun's elevation above the horizon in degrees, as seen at `date` from
 * `latitude`/`longitude` (degrees, north and east positive).
 *
 * @param {Date} date
 * @param {number} latitude
 * @param {number} longitude
 * @returns {number}
 */
export function sunElevation(date, latitude, longitude) {
    const days = date.getTime() / DAY_MS - UNIX_EPOCH_TO_J2000_DAYS;

    const meanLongitude = 280.460 + 0.9856474 * days;
    const meanAnomaly = (357.528 + 0.9856003 * days) * RAD;
    const eclipticLongitude = (meanLongitude +
        1.915 * Math.sin(meanAnomaly) +
        0.020 * Math.sin(2 * meanAnomaly)) * RAD;
    const obliquity = (23.439 - 0.0000004 * days) * RAD;

    const rightAscension = Math.atan2(
        Math.cos(obliquity) * Math.sin(eclipticLongitude),
        Math.cos(eclipticLongitude));
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

    const siderealTime = (280.46061837 + 360.98564736629 * days + longitude) * RAD;
    const hourAngle = siderealTime - rightAscension;

    const phi = latitude * RAD;
    return Math.asin(
        Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)) / RAD;
}

/**
 * Every moment in [`from`, `until`) at which the sun passes `elevation`,
 * rising or setting, in order.
 *
 * @param {Date} from
 * @param {Date} until
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} elevation - degrees
 * @returns {Date[]}
 */
export function crossings(from, until, latitude, longitude, elevation) {
    const isAbove = time => sunElevation(new Date(time), latitude, longitude) > elevation;
    const end = until.getTime();
    const found = [];

    let before = from.getTime();
    let wasAbove = isAbove(before);
    while (before < end) {
        const stepEnd = Math.min(before + SEARCH_STEP_MS, end);
        if (isAbove(stepEnd) === wasAbove) {
            before = stepEnd;
            continue;
        }

        let low = before, high = stepEnd;
        while (high - low > 1000) {
            const middle = (low + high) / 2;
            if (isAbove(middle) === wasAbove)
                low = middle;
            else
                high = middle;
        }
        found.push(new Date(high));
        before = stepEnd;
        wasAbove = !wasAbove;
    }
    return found;
}
