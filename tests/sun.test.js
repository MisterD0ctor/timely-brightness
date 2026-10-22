// Run with: gjs -m tests/sun.test.js
// Reference times are the published sunrise and sunset for Stockholm
// (59.33 N, 18.07 E), rounded to the minute.

import {crossings, HORIZON} from '../extension/lib/sun.js';
import {SunClock} from '../extension/lib/clock.js';
import {levelAt, sunDay, DAY_LEVEL, DAY_ELEVATION, DUSK_ELEVATION, NIGHT_ELEVATION} from '../extension/lib/curve.js';

const LATITUDE = 59.33;
const LONGITUDE = 18.07;
const TOLERANCE_MINUTES = 2;
const RHYTHM = {morning: 7 * 60, evening: 19 * 60};

let failures = 0;
function check(name, ok, detail = '') {
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok)
        failures++;
}

function checkTime(name, actual, expected) {
    expected = new Date(expected);
    const minutes = Math.abs(actual - expected) / 60000;
    check(name, minutes <= TOLERANCE_MINUTES,
        `${actual.toISOString()} vs ${expected.toISOString()} (${minutes.toFixed(1)} min)`);
}

const localTime = (date, hours, minutes) => {
    const time = new Date(date);
    time.setHours(hours, minutes, 0, 0);
    return time;
};

const sunTimes = day => crossings(new Date(`${day}T00:00:00Z`), new Date(`${day}T23:59:59Z`),
    LATITUDE, LONGITUDE, HORIZON);

const [juneRise, juneSet] = sunTimes('2026-06-21');
checkTime('midsummer sunrise', juneRise, '2026-06-21T01:31:00Z');
checkTime('midsummer sunset', juneSet, '2026-06-21T20:08:00Z');

const [winterRise, winterSet] = sunTimes('2026-12-21');
checkTime('midwinter sunrise', winterRise, '2026-12-21T07:43:00Z');
checkTime('midwinter sunset', winterSet, '2026-12-21T13:48:00Z');

check('day level above the golden hour', levelAt(DAY_ELEVATION + 1, 60, 30) === DAY_LEVEL);
check('dusk level at sunset', levelAt(DUSK_ELEVATION, 60, 30) === 60);
check('night level at end of civil twilight', levelAt(NIGHT_ELEVATION, 60, 30) === 30);
check('night level deep in the night', levelAt(-30, 60, 30) === 30);
const between = levelAt((DUSK_ELEVATION + NIGHT_ELEVATION) / 2, 60, 30);
check('halfway between dusk and night', Math.abs(between - 45) < 1e-9, `${between}`);

const winterNoon = new Date('2026-12-21T11:00:00Z');
const unweighted = new SunClock(winterNoon, LATITUDE, LONGITUDE, {...RHYTHM, weight: 0});
check('weight 0 leaves the clock alone', unweighted.toSun(winterNoon).getTime() === winterNoon.getTime());
checkTime('weight 0: next change is the real sunset', unweighted.nextChange(winterNoon), winterSet);

const halfway = new SunClock(winterNoon, LATITUDE, LONGITUDE, {...RHYTHM, weight: 0.5});
const winterEvening = localTime(winterSet, 19, 0);
const movedSet = new Date((winterSet.getTime() + winterEvening.getTime()) / 2);
checkTime('weight 0.5: sunset moves halfway to the evening time', halfway.toClock(winterSet), movedSet);
checkTime('weight 0.5: the moved sunset maps back to the real one', halfway.toSun(movedSet), winterSet);
checkTime('weight 0.5: next change is the moved sunset', halfway.nextChange(winterNoon), movedSet);
const movedRise = halfway.toClock(winterRise);
checkTime('weight 0.5: sunrise moves halfway to the morning time', movedRise,
    (winterRise.getTime() + localTime(winterRise, 7, 0).getTime()) / 2);

let monotonic = true;
for (let t = winterNoon.getTime() - 86400000, last = -Infinity; t < winterNoon.getTime() + 86400000; t += 300000) {
    const sun = halfway.toSun(new Date(t)).getTime();
    monotonic &&= sun > last;
    last = sun;
}
check('weight 0.5: the clock never runs backwards', monotonic);

const svalbard = new SunClock(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6, {...RHYTHM, weight: 0.5});
const polarNoon = new Date('2026-06-21T12:00:00Z');
check('polar day: no sunset to move, so the clock is left alone',
    svalbard.toSun(polarNoon).getTime() === polarNoon.getTime() && svalbard.nextChange(polarNoon) === null);

const day = sunDay(new Date(2026, 9, 22, 12), LATITUDE, LONGITUDE, unweighted);
check('a day has a sunrise and a sunset', day.duskTimes.length === 2);
check('a day has two ends of civil twilight', day.nightTimes.length === 2);
check('samples are in order', day.samples.every((s, i) => i === 0 || day.samples[i - 1].time <= s.time));
check('two dark spans, either side of midnight', day.darkSpans.length === 2);

const midsummerNoon = new Date(2026, 5, 21, 12);
const midsummer = sunDay(midsummerNoon, LATITUDE, LONGITUDE,
    new SunClock(midsummerNoon, LATITUDE, LONGITUDE, {...RHYTHM, weight: 0}));
check('Stockholm midsummer still reaches the end of civil twilight', midsummer.nightTimes.length === 2);

const movedMidsummer = sunDay(midsummerNoon, LATITUDE, LONGITUDE,
    new SunClock(midsummerNoon, LATITUDE, LONGITUDE, {...RHYTHM, weight: 0.5}));
checkTime('weight 0.5: the graph\'s evening dusk is the moved sunset', movedMidsummer.duskTimes.at(-1),
    (juneSet.getTime() + localTime(juneSet, 19, 0).getTime()) / 2);

// Worked figures for Stockholm in Swedish time; skipped in other time zones.
if (new Date('2026-12-21T12:00:00Z').getTimezoneOffset() === -60) {
    const local = date => date.toTimeString().slice(0, 5);
    check('Stockholm, weight 0.5: midwinter sunset 14:48 moves to about 16:54',
        local(halfway.toClock(winterSet)) === '16:54', local(halfway.toClock(winterSet)));
    check('Stockholm, weight 0.5: midsummer sunset 22:08 moves to about 20:34',
        local(movedMidsummer.duskTimes.at(-1)) === '20:34', local(movedMidsummer.duskTimes.at(-1)));
}

if (failures)
    imports.system.exit(1);
