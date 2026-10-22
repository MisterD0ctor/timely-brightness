// Run with: gjs -m tests/sun.test.js
// Reference times are the published sunrise and sunset for Stockholm
// (59.33 N, 18.07 E), rounded to the minute.

import {nextSunriseOrSunset, crossings, HORIZON} from '../extension/lib/sun.js';
import {levelAt, sunDay, DAY_LEVEL, DAY_ELEVATION, DUSK_ELEVATION, NIGHT_ELEVATION} from '../extension/lib/curve.js';

const LATITUDE = 59.33;
const LONGITUDE = 18.07;
const TOLERANCE_MINUTES = 2;

let failures = 0;
function check(name, ok, detail = '') {
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok)
        failures++;
}

function checkTime(name, actual, expectedIso) {
    const expected = new Date(expectedIso);
    const minutes = Math.abs(actual - expected) / 60000;
    check(name, minutes <= TOLERANCE_MINUTES,
        `${actual.toISOString()} vs ${expected.toISOString()} (${minutes.toFixed(1)} min)`);
}

const sunTimes = day => crossings(new Date(`${day}T00:00:00Z`), new Date(`${day}T23:59:59Z`),
    LATITUDE, LONGITUDE, HORIZON);

const [juneRise, juneSet] = sunTimes('2026-06-21');
checkTime('midsummer sunrise', juneRise, '2026-06-21T01:31:00Z');
checkTime('midsummer sunset', juneSet, '2026-06-21T20:08:00Z');

const [winterRise, winterSet] = sunTimes('2026-12-21');
checkTime('midwinter sunrise', winterRise, '2026-12-21T07:43:00Z');
checkTime('midwinter sunset', winterSet, '2026-12-21T13:48:00Z');

checkTime('next after midwinter noon is sunset',
    nextSunriseOrSunset(new Date('2026-12-21T11:00:00Z'), LATITUDE, LONGITUDE), '2026-12-21T13:48:00Z');

check('day level above the golden hour', levelAt(DAY_ELEVATION + 1, 60, 30) === DAY_LEVEL);
check('dusk level at sunset', levelAt(DUSK_ELEVATION, 60, 30) === 60);
check('night level at end of civil twilight', levelAt(NIGHT_ELEVATION, 60, 30) === 30);
check('night level deep in the night', levelAt(-30, 60, 30) === 30);
const between = levelAt((DUSK_ELEVATION + NIGHT_ELEVATION) / 2, 60, 30);
check('halfway between dusk and night', Math.abs(between - 45) < 1e-9, `${between}`);

const day = sunDay(new Date(2026, 9, 22, 12), LATITUDE, LONGITUDE);
check('a day has a sunrise and a sunset', day.duskTimes.length === 2);
check('a day has two ends of civil twilight', day.nightTimes.length === 2);
check('samples are in order', day.samples.every((s, i) => i === 0 || day.samples[i - 1].time <= s.time));
check('two dark spans, either side of midnight', day.darkSpans.length === 2);

const midsummer = sunDay(new Date(2026, 5, 21, 12), LATITUDE, LONGITUDE);
check('Stockholm midsummer still reaches the end of civil twilight', midsummer.nightTimes.length === 2);

if (failures)
    imports.system.exit(1);
