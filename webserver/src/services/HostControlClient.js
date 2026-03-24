import fs from 'fs';
import http from 'http';

const DEFAULT_SOCKET_PATH = process.env.HOST_CONTROL_SOCKET?.trim() || '/run/roomsense-hostctl/hostctl.sock';
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.HOST_CONTROL_TIMEOUT_MS || '4000', 10);

export class HostControlError extends Error {
    constructor(message, { statusCode = null, code = null, detail = null, cause = null } = {}) {
        super(message);
        this.name = 'HostControlError';
        this.statusCode = statusCode;
        this.code = code;
        this.detail = detail;
        this.cause = cause;
    }
}

const getSocketPath = () => process.env.HOST_CONTROL_SOCKET?.trim() || DEFAULT_SOCKET_PATH;

const isSocketAvailable = () => {
    const socketPath = getSocketPath();

    try {
        if (!fs.existsSync(socketPath)) {
            return false;
        }

        return fs.statSync(socketPath).isSocket();
    } catch {
        return false;
    }
};

const parsePayload = (rawBody) => {
    if (!rawBody) {
        return null;
    }

    try {
        return JSON.parse(rawBody);
    } catch (error) {
        throw new HostControlError('Host control helper returned invalid JSON.', {
            code: 'HOST_CONTROL_INVALID_JSON',
            detail: error.message,
            cause: error,
        });
    }
};

const request = (method, path, body = null, timeoutMs = DEFAULT_TIMEOUT_MS) => new Promise((resolve, reject) => {
    if (!isSocketAvailable()) {
        reject(new HostControlError('Host control helper socket is unavailable.', {
            code: 'HOST_CONTROL_UNAVAILABLE',
        }));
        return;
    }

    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
        socketPath: getSocketPath(),
        path,
        method,
        headers: payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        } : undefined,
    }, (res) => {
        let rawBody = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            rawBody += chunk;
        });
        res.on('end', () => {
            let parsed = null;

            try {
                parsed = parsePayload(rawBody);
            } catch (error) {
                reject(error);
                return;
            }

            if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(parsed);
                return;
            }

            reject(new HostControlError(
                parsed?.error || parsed?.message || 'Host control request failed.',
                {
                    statusCode: res.statusCode,
                    code: parsed?.code || 'HOST_CONTROL_REQUEST_FAILED',
                    detail: parsed?.detail || null,
                }
            ));
        });
    });

    req.setTimeout(timeoutMs, () => {
        req.destroy(new HostControlError('Host control request timed out.', {
            code: 'HOST_CONTROL_TIMEOUT',
        }));
    });

    req.on('error', (error) => {
        if (error instanceof HostControlError) {
            reject(error);
            return;
        }

        reject(new HostControlError('Failed to reach host control helper.', {
            code: error.code || 'HOST_CONTROL_REQUEST_ERROR',
            detail: error.message,
            cause: error,
        }));
    });

    if (payload) {
        req.write(payload);
    }

    req.end();
});

const hostControl = {
    isAvailable: isSocketAvailable,
    isUnavailableError: (error) => (
        error instanceof HostControlError && (
            error.code === 'HOST_CONTROL_UNAVAILABLE' ||
            error.code === 'ENOENT' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'EPIPE'
        )
    ),
    getHealth: () => request('GET', '/health'),
    getWifiStatus: () => request('GET', '/wifi/status'),
    getWifiNetworks: () => request('GET', '/wifi/networks', null, Number.parseInt(process.env.HOST_CONTROL_SCAN_TIMEOUT_MS || '12000', 10)),
    connectWifi: (payload) => request('POST', '/wifi/connect', payload),
    reboot: () => request('POST', '/reboot'),
};

export default hostControl;
