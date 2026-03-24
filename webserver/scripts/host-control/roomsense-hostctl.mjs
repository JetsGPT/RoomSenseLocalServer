import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOCKET_PATH = process.env.ROOMSENSE_HOSTCTL_SOCKET?.trim()
    || path.resolve(__dirname, '../../host-control-runtime/hostctl.sock');
const SOCKET_UID = Number.parseInt(process.env.ROOMSENSE_HOSTCTL_SOCKET_UID || '1000', 10);
const SOCKET_GID = Number.parseInt(process.env.ROOMSENSE_HOSTCTL_SOCKET_GID || '1000', 10);
const WIFI_INTERFACE_OVERRIDE = process.env.ROOMSENSE_WIFI_INTERFACE?.trim() || '';
const WIFI_RESCAN_MODE = process.env.ROOMSENSE_WIFI_RESCAN?.trim() || 'auto';
const MAX_BODY_BYTES = 8 * 1024;
const JOBS_DIR = path.join(path.dirname(SOCKET_PATH), 'jobs');

const NMCLI_CANDIDATES = ['/usr/bin/nmcli', '/bin/nmcli', 'nmcli'];
const SYSTEMCTL_CANDIDATES = ['/usr/bin/systemctl', '/bin/systemctl', 'systemctl'];
const REBOOT_CANDIDATES = ['/sbin/reboot', '/usr/sbin/reboot', '/bin/reboot', 'reboot'];

const startTime = Date.now();
const currentScript = __filename;

const log = (level, message, detail = null) => {
    const suffix = detail ? ` ${JSON.stringify(detail)}` : '';
    console.log(`[roomsense-hostctl] [${level}] ${message}${suffix}`);
};

const createHttpError = (statusCode, code, message, detail = null) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    error.detail = detail;
    return error;
};

const ensureRuntimeDirectory = () => {
    fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });
    fs.mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(JOBS_DIR, 0o700);
};

const cleanupSocketFile = () => {
    if (!fs.existsSync(SOCKET_PATH)) {
        return;
    }

    const stat = fs.statSync(SOCKET_PATH);
    if (!stat.isSocket()) {
        throw new Error(`Refusing to replace non-socket file at ${SOCKET_PATH}`);
    }

    fs.unlinkSync(SOCKET_PATH);
};

const parseNmcliFields = (line) => {
    const fields = [];
    let current = '';
    let escaped = false;

    for (const character of line) {
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }

        if (character === '\\') {
            escaped = true;
            continue;
        }

        if (character === ':') {
            fields.push(current);
            current = '';
            continue;
        }

        current += character;
    }

    if (escaped) {
        current += '\\';
    }

    fields.push(current);
    return fields;
};

const resolveExecutable = (candidates) => {
    for (const candidate of candidates) {
        if (!candidate.includes(path.sep)) {
            return candidate;
        }

        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[candidates.length - 1];
};

const runCommand = async (command, args, { timeoutMs = 30000, sensitive = false } = {}) => {
    try {
        const { stdout, stderr } = await execFileAsync(command, args, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
        });

        if (!sensitive) {
            log('info', `Executed ${command}`, {
                args,
                stderr: stderr?.trim() || null,
            });
        } else {
            log('info', `Executed sensitive command ${command}`);
        }

        return stdout.trim();
    } catch (error) {
        const detail = error.stderr?.trim() || error.message || 'Unknown error';

        if (!sensitive) {
            log('error', `Command failed: ${command}`, {
                args,
                detail,
            });
        } else {
            log('error', `Sensitive command failed: ${command}`, { detail });
        }

        throw createHttpError(500, 'COMMAND_FAILED', `Command failed: ${path.basename(command)}`, detail);
    }
};

const getNmcliBinary = () => resolveExecutable(NMCLI_CANDIDATES);

const getSystemctlBinary = () => resolveExecutable(SYSTEMCTL_CANDIDATES);

const getWifiInterface = async () => {
    if (WIFI_INTERFACE_OVERRIDE) {
        return WIFI_INTERFACE_OVERRIDE;
    }

    const output = await runCommand(getNmcliBinary(), ['-t', '-f', 'DEVICE,TYPE', 'device', 'status']);
    const lines = output.split('\n').filter(Boolean);

    for (const line of lines) {
        const [device, type] = parseNmcliFields(line);
        if (type === 'wifi' && device) {
            return device;
        }
    }

    return 'wlan0';
};

const isWifiType = (value) => value === 'wifi' || value === '802-11-wireless' || value === 'wireless';

const resolveConnectionSsid = async (identifier) => {
    if (!identifier) {
        return null;
    }

    try {
        const output = await runCommand(getNmcliBinary(), ['-g', '802-11-wireless.ssid', 'connection', 'show', identifier]);
        return output || identifier;
    } catch {
        return identifier;
    }
};

const getSavedWifiSsids = async () => {
    const output = await runCommand(getNmcliBinary(), ['-t', '-f', 'UUID,TYPE,NAME', 'connection', 'show']);
    const lines = output.split('\n').filter(Boolean);
    const savedSsids = new Set();

    for (const line of lines) {
        const [uuid, type, name] = parseNmcliFields(line);
        if (!isWifiType(type)) {
            continue;
        }

        const resolved = await resolveConnectionSsid(uuid || name);
        if (resolved) {
            savedSsids.add(resolved);
        }

        if (name) {
            savedSsids.add(name);
        }
    }

    return savedSsids;
};

const getCurrentWifiStatus = async () => {
    const fallbackInterface = await getWifiInterface();
    const output = await runCommand(getNmcliBinary(), ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']);
    const lines = output.split('\n').filter(Boolean);

    for (const line of lines) {
        const [device, type, state, connection] = parseNmcliFields(line);
        if (!isWifiType(type)) {
            continue;
        }

        if (state?.startsWith('connected')) {
            const ssid = await resolveConnectionSsid(connection);
            return {
                connected: true,
                ssid: ssid || connection || null,
                interface: device || fallbackInterface || null,
            };
        }
    }

    return {
        connected: false,
        ssid: null,
        interface: fallbackInterface || null,
    };
};

const normalizeSecurity = (security) => {
    if (!security || security === '--') {
        return '';
    }

    return security;
};

const scanVisibleWifiNetworks = async () => {
    const output = await runCommand(getNmcliBinary(), [
        '-t',
        '-f',
        'IN-USE,SSID,SIGNAL,SECURITY',
        'device',
        'wifi',
        'list',
        '--rescan',
        WIFI_RESCAN_MODE,
    ], {
        timeoutMs: 45000,
    });

    const bySsid = new Map();

    for (const line of output.split('\n').filter(Boolean)) {
        const [inUse, ssidRaw, signalRaw, securityRaw] = parseNmcliFields(line);
        const ssid = ssidRaw?.trim();

        if (!ssid || ssid === '--' || ssid === 'RoomSenseSetup') {
            continue;
        }

        const signal = Number.parseInt(signalRaw || '', 10);
        const security = normalizeSecurity(securityRaw);
        const next = {
            ssid,
            signal: Number.isFinite(signal) ? signal : null,
            security,
            requiresPassword: Boolean(security),
            isCurrent: inUse === '*',
            isSaved: false,
        };

        const existing = bySsid.get(ssid);
        if (!existing) {
            bySsid.set(ssid, next);
            continue;
        }

        const currentSignal = Number.isFinite(existing.signal) ? existing.signal : -1;
        const nextSignal = Number.isFinite(next.signal) ? next.signal : -1;

        if (next.isCurrent || nextSignal > currentSignal) {
            bySsid.set(ssid, {
                ...existing,
                ...next,
                isCurrent: existing.isCurrent || next.isCurrent,
            });
        } else if (next.isCurrent) {
            existing.isCurrent = true;
        }
    }

    return Array.from(bySsid.values());
};

const getWifiNetworksPayload = async () => {
    const [current, visibleNetworks, savedSsids] = await Promise.all([
        getCurrentWifiStatus(),
        scanVisibleWifiNetworks(),
        getSavedWifiSsids(),
    ]);

    const bySsid = new Map();

    for (const network of visibleNetworks) {
        bySsid.set(network.ssid, {
            ...network,
            isSaved: savedSsids.has(network.ssid),
        });
    }

    if (current.connected && current.ssid) {
        const existing = bySsid.get(current.ssid);
        bySsid.set(current.ssid, {
            ssid: current.ssid,
            signal: existing?.signal ?? null,
            security: existing?.security ?? '',
            requiresPassword: existing?.requiresPassword ?? false,
            isCurrent: true,
            isSaved: true,
        });
    }

    const networks = Array.from(bySsid.values()).sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) {
            return left.isCurrent ? -1 : 1;
        }

        const leftSignal = Number.isFinite(left.signal) ? left.signal : -1;
        const rightSignal = Number.isFinite(right.signal) ? right.signal : -1;
        if (leftSignal !== rightSignal) {
            return rightSignal - leftSignal;
        }

        return left.ssid.localeCompare(right.ssid);
    });

    return {
        wifiSupported: true,
        current,
        networks,
    };
};

const validateSsid = (value) => {
    if (typeof value !== 'string') {
        throw createHttpError(400, 'INVALID_SSID', 'SSID is required.');
    }

    const trimmed = value.trim();
    if (!trimmed) {
        throw createHttpError(400, 'INVALID_SSID', 'SSID is required.');
    }

    if (trimmed.length > 64) {
        throw createHttpError(400, 'INVALID_SSID', 'SSID is too long.');
    }

    if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
        throw createHttpError(400, 'INVALID_SSID', 'SSID contains invalid control characters.');
    }

    return trimmed;
};

const validatePassword = (value) => {
    if (value == null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw createHttpError(400, 'INVALID_PASSWORD', 'Password must be a string.');
    }

    if (value.length === 0) {
        return null;
    }

    if (/[\u0000-\u001F\u007F]/.test(value)) {
        throw createHttpError(400, 'INVALID_PASSWORD', 'Password contains invalid control characters.');
    }

    if (value.length < 8 || value.length > 64) {
        throw createHttpError(400, 'INVALID_PASSWORD', 'Password must be between 8 and 64 characters.');
    }

    return value;
};

const queueWifiConnectJob = ({ ssid, password }) => {
    const jobFilePath = path.join(JOBS_DIR, `${Date.now()}-${crypto.randomUUID()}.json`);
    const payload = JSON.stringify({
        ssid,
        password,
        requestedAt: new Date().toISOString(),
    });

    fs.writeFileSync(jobFilePath, payload, {
        encoding: 'utf8',
        mode: 0o600,
    });

    const child = spawn(process.execPath, [currentScript, '--wifi-job', jobFilePath], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
    });

    child.unref();
};

const removeMatchingWifiProfiles = async (ssid) => {
    const output = await runCommand(getNmcliBinary(), ['-t', '-f', 'UUID,TYPE,NAME', 'connection', 'show']);

    for (const line of output.split('\n').filter(Boolean)) {
        const [uuid, type, name] = parseNmcliFields(line);
        if (!isWifiType(type)) {
            continue;
        }

        const resolvedSsid = await resolveConnectionSsid(uuid || name);
        if (resolvedSsid === ssid || name === ssid || name === `wifi-${ssid}`) {
            try {
                await runCommand(getNmcliBinary(), ['connection', 'delete', uuid || name]);
            } catch (error) {
                log('warn', 'Failed to delete existing Wi-Fi profile before reconnecting.', {
                    ssid,
                    detail: error.detail || error.message,
                });
            }
        }
    }
};

const connectToWifi = async ({ ssid, password }) => {
    await removeMatchingWifiProfiles(ssid);

    const args = ['device', 'wifi', 'connect', ssid];
    if (password) {
        args.push('password', password);
    }

    await runCommand(getNmcliBinary(), args, {
        timeoutMs: 90000,
        sensitive: Boolean(password),
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const current = await getCurrentWifiStatus();
    if (!current.connected || current.ssid !== ssid) {
        throw createHttpError(500, 'WIFI_CONNECT_VERIFY_FAILED', 'Wi-Fi connection did not become active after switching.');
    }
};

const loadWifiJob = (jobFilePath) => {
    const raw = fs.readFileSync(jobFilePath, 'utf8');
    fs.unlinkSync(jobFilePath);
    return JSON.parse(raw);
};

const executeWifiJob = async (jobFilePath) => {
    const job = loadWifiJob(jobFilePath);
    const ssid = validateSsid(job?.ssid);
    const password = validatePassword(job?.password);

    try {
        log('info', 'Starting Wi-Fi switch job.', { ssid });
        await connectToWifi({ ssid, password });
        log('info', 'Wi-Fi switch job completed.', { ssid });
    } catch (error) {
        log('error', 'Wi-Fi switch job failed.', {
            ssid,
            detail: error.detail || error.message,
            code: error.code || null,
        });
    }
};

const triggerHostReboot = async () => {
    const rebootCandidates = [
        { command: getSystemctlBinary(), args: ['reboot'] },
        ...REBOOT_CANDIDATES.map((command) => ({ command, args: [] })),
    ];

    let lastError = null;

    for (const candidate of rebootCandidates) {
        try {
            const child = spawn(candidate.command, candidate.args, {
                detached: true,
                stdio: 'ignore',
            });

            await new Promise((resolve, reject) => {
                child.once('spawn', resolve);
                child.once('error', reject);
            });

            child.unref();
            return {
                status: 'rebooting',
                message: 'Host reboot command launched.',
                source: 'host-control',
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw createHttpError(500, 'REBOOT_FAILED', 'Failed to launch host reboot command.', lastError?.message || null);
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
    let rawBody = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
        rawBody += chunk;
        if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
            reject(createHttpError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.'));
            req.destroy();
        }
    });
    req.on('end', () => {
        if (!rawBody) {
            resolve({});
            return;
        }

        try {
            resolve(JSON.parse(rawBody));
        } catch (error) {
            reject(createHttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.', error.message));
        }
    });
    req.on('error', (error) => {
        reject(createHttpError(400, 'REQUEST_STREAM_FAILED', 'Failed to read request body.', error.message));
    });
});

const sendJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
};

const handleRequest = async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://roomsense-hostctl.local');

    if (req.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(res, 200, {
            status: 'ok',
            rebootSupported: true,
            rebootLabel: 'Reboot Raspberry Pi',
            uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        });
        return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/wifi/status') {
        sendJson(res, 200, {
            wifiSupported: true,
            current: await getCurrentWifiStatus(),
        });
        return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/wifi/networks') {
        sendJson(res, 200, await getWifiNetworksPayload());
        return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/wifi/connect') {
        const body = await readJsonBody(req);
        const ssid = validateSsid(body?.ssid);
        const password = validatePassword(body?.password);
        const wifiNetworks = await getWifiNetworksPayload();
        const selectedNetwork = wifiNetworks.networks.find((network) => network.ssid === ssid);
        const isSaved = selectedNetwork?.isSaved || false;
        const requiresPassword = selectedNetwork?.requiresPassword || false;

        if (!password && requiresPassword && !isSaved) {
            throw createHttpError(400, 'PASSWORD_REQUIRED', 'This Wi-Fi network requires a password.');
        }

        if (!password && !selectedNetwork && !isSaved) {
            throw createHttpError(400, 'PASSWORD_REQUIRED', 'A password is required for unknown Wi-Fi networks.');
        }

        queueWifiConnectJob({ ssid, password });
        sendJson(res, 202, {
            status: 'switching',
            message: `Switching the Raspberry Pi to "${ssid}". RoomSense will disappear while the network changes and may take a few minutes to return.`,
            targetSsid: ssid,
        });
        return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/reboot') {
        sendJson(res, 202, await triggerHostReboot());
        return;
    }

    throw createHttpError(404, 'NOT_FOUND', 'Unknown host control endpoint.');
};

const startServer = () => {
    ensureRuntimeDirectory();
    cleanupSocketFile();

    const server = http.createServer((req, res) => {
        Promise.resolve(handleRequest(req, res)).catch((error) => {
            const statusCode = error.statusCode || 500;
            sendJson(res, statusCode, {
                error: error.message || 'Host control request failed.',
                detail: error.detail || null,
                code: error.code || 'HOST_CONTROL_ERROR',
            });
        });
    });

    server.listen(SOCKET_PATH, () => {
        try {
            fs.chmodSync(SOCKET_PATH, 0o660);
            fs.chownSync(SOCKET_PATH, SOCKET_UID, SOCKET_GID);
        } catch (error) {
            log('warn', 'Failed to set socket ownership or mode.', {
                detail: error.message,
                socketPath: SOCKET_PATH,
            });
        }

        log('info', 'Host control helper listening.', {
            socketPath: SOCKET_PATH,
        });
    });

    const shutdown = () => {
        server.close(() => {
            try {
                cleanupSocketFile();
            } catch {
                // Socket already removed.
            }
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

const run = async () => {
    const jobFlagIndex = process.argv.indexOf('--wifi-job');
    if (jobFlagIndex >= 0) {
        const jobFilePath = process.argv[jobFlagIndex + 1];
        if (!jobFilePath) {
            throw new Error('Missing Wi-Fi job file path.');
        }

        await executeWifiJob(jobFilePath);
        process.exit(0);
    }

    startServer();
};

run().catch((error) => {
    log('error', 'Host control helper failed to start.', {
        detail: error.detail || error.message,
        code: error.code || null,
    });
    process.exit(1);
});
