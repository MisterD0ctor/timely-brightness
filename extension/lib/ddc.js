import Gio from 'gi://Gio';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

/** The MCCS feature code for luminance, which monitors expose as brightness. */
const BRIGHTNESS = '10';

async function ddcutil(args, cancellable) {
    const proc = Gio.Subprocess.new(['ddcutil', ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
    if (!proc.get_successful())
        throw new Error(`ddcutil ${args.join(' ')}: ${stderr.trim() || stdout.trim()}`);
    return stdout;
}

/**
 * One monitor that answers DDC/CI, addressed by its I2C bus. Each ddcutil
 * call takes about half a second, so writes are queued per monitor and only
 * the newest value waiting is written.
 */
export class Monitor {
    /**
     * @param {object} params
     * @param {string} params.id - EDID manufacturer, model and serial, e.g. `DEL:AW3423DWF:GYC42S3`
     * @param {string} params.model
     * @param {string} params.connector - e.g. `DP-3`
     * @param {number} params.bus - the `/dev/i2c-N` number, which can change between boots
     * @param {Gio.Cancellable} cancellable - stops waiting on ddcutil when cancelled
     */
    constructor({id, model, connector, bus}, cancellable) {
        this.id = id;
        this.model = model;
        this.connector = connector;
        this.bus = bus;
        this._cancellable = cancellable;

        /** Brightness in the monitor's own units, or null until read. */
        this.value = null;
        /** The monitor's maximum brightness value, or null until read. */
        this.max = null;

        this._target = null;
        this._writing = false;
    }

    /** Reads the monitor's brightness and its maximum. */
    async read() {
        const output = await ddcutil(['--bus', `${this.bus}`, 'getvcp', BRIGHTNESS, '--brief'],
            this._cancellable);
        const match = output.match(/^VCP 10 C (\d+) (\d+)/m);
        if (!match)
            throw new Error(`Unexpected ddcutil output for ${this.id}: ${output.trim()}`);
        this.value = Number(match[1]);
        this.max = Number(match[2]);
    }

    /**
     * Asks for `value`, in the monitor's own units. Returns at once; the
     * write happens in the background.
     *
     * @param {number} value
     */
    set(value) {
        this._target = value;
        if (this._writing)
            return;
        this._write().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Timely Brightness: could not set ${this.id}: ${e.message}`);
        });
    }

    async _write() {
        this._writing = true;
        try {
            while (this._target !== this.value) {
                const target = this._target;
                // Verifying would cost a read per write, and a monitor that
                // missed a value is corrected by the next one anyway.
                await ddcutil(['--bus', `${this.bus}`, 'setvcp', BRIGHTNESS, `${target}`, '--noverify'],
                    this._cancellable);
                this.value = target;
            }
        } finally {
            this._writing = false;
        }
    }
}

/**
 * Finds the monitors that answer DDC/CI. Takes a second or two.
 *
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<Monitor[]>}
 */
export async function detect(cancellable) {
    const output = await ddcutil(['detect', '--brief'], cancellable);
    const monitors = [];
    // Blocks headed "Invalid display" (DDC/CI off or unsupported, such as a
    // laptop panel) or "Phantom display" (a second connector of a monitor
    // already listed) are skipped.
    for (const block of output.split(/\n\s*\n/)) {
        if (!/^Display \d+/.test(block.trim()))
            continue;
        const bus = block.match(/I2C bus:\s*\/dev\/i2c-(\d+)/)?.[1];
        const id = block.match(/Monitor:\s*(\S+)/)?.[1];
        if (!bus || !id)
            continue;
        const connector = block.match(/DRM connector:\s*card\d+-(\S+)/)?.[1] ?? '';
        const model = id.split(':')[1] || id;
        monitors.push(new Monitor({id, model, connector, bus: Number(bus)}, cancellable));
    }
    return monitors;
}
