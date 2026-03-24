import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { requireLogin, requireRole } from '../auth/auth.js';
import hostControl from '../services/HostControlClient.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_PATH = path.resolve(__dirname, '../../package.json');

const readBackendVersion = () => {
    try {
        const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
        return packageJson.version || 'unknown';
    } catch (error) {
        console.error('[System] Failed to read backend version:', error);
        return 'unknown';
    }
};

const parseCommandArgs = (rawArgs) => {
    if (!rawArgs) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawArgs);
        if (Array.isArray(parsed)) {
            return parsed.map((value) => String(value));
        }
    } catch {
        // Fall back to a simple whitespace split for plain strings.
    }

    return rawArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
};

const getRebootConfig = () => {
    const command = process.env.SYSTEM_REBOOT_COMMAND?.trim() || '';

    return {
        command,
        args: parseCommandArgs(process.env.SYSTEM_REBOOT_ARGS),
        label: process.env.SYSTEM_REBOOT_LABEL?.trim() || 'Reboot device',
        supported: true,
        configured: Boolean(command),
    };
};

const getEmptyWifiInfo = () => ({
    wifiSupported: false,
    wifiConnected: false,
    wifiSsid: null,
    wifiInterface: null,
});

const buildSystemInfo = async (req) => {
    const reboot = getRebootConfig();
    const frontendBuildPresent = Boolean(req.app.locals.hasFrontendBuild?.());
    const info = {
        backendVersion: readBackendVersion(),
        rebootSupported: reboot.supported,
        rebootConfigured: reboot.configured,
        rebootLabel: reboot.label,
        frontendBuildPresent,
        hostControlAvailable: false,
        ...getEmptyWifiInfo(),
    };

    if (!hostControl.isAvailable()) {
        return info;
    }

    const [healthResult, wifiStatusResult] = await Promise.allSettled([
        hostControl.getHealth(),
        hostControl.getWifiStatus(),
    ]);

    if (healthResult.status === 'fulfilled') {
        info.hostControlAvailable = true;
        info.rebootSupported = Boolean(healthResult.value?.rebootSupported ?? true);
        info.rebootConfigured = Boolean(healthResult.value?.rebootSupported ?? true);
        info.rebootLabel = healthResult.value?.rebootLabel?.trim() || reboot.label;
    } else if (!hostControl.isUnavailableError(healthResult.reason)) {
        console.error('[System] Host control health check failed:', healthResult.reason);
    }

    if (wifiStatusResult.status === 'fulfilled') {
        info.hostControlAvailable = true;
        info.wifiSupported = Boolean(wifiStatusResult.value?.wifiSupported);
        info.wifiConnected = Boolean(wifiStatusResult.value?.current?.connected);
        info.wifiSsid = wifiStatusResult.value?.current?.ssid || null;
        info.wifiInterface = wifiStatusResult.value?.current?.interface || null;
    } else if (!hostControl.isUnavailableError(wifiStatusResult.reason)) {
        console.error('[System] Host control Wi-Fi status failed:', wifiStatusResult.reason);
    }

    return info;
};

const launchConfiguredReboot = async (reboot, username) => {
    const child = spawn(reboot.command, reboot.args, {
        detached: true,
        stdio: 'ignore',
    });

    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });

    child.unref();

    console.log(`[System] Reboot command launched by user ${username}.`);

    return {
        status: 'rebooting',
        message: `${reboot.label} command launched.`,
        source: 'configured-command',
    };
};

router.get('/info', requireLogin, async (req, res) => {
    try {
        const info = await buildSystemInfo(req);
        res.status(200).json(info);
    } catch (error) {
        console.error('[System] Failed to build system info:', error);
        res.status(500).json({ error: 'Failed to load system information' });
    }
});

router.get('/wifi/networks', requireLogin, requireRole('admin'), async (req, res) => {
    if (!hostControl.isAvailable()) {
        return res.status(503).json({
            error: 'Wi-Fi controls are unavailable on this backend.',
            code: 'WIFI_UNAVAILABLE',
        });
    }

    try {
        const payload = await hostControl.getWifiNetworks();
        return res.status(200).json(payload);
    } catch (error) {
        if (hostControl.isUnavailableError(error)) {
            return res.status(503).json({
                error: 'Wi-Fi controls are unavailable on this backend.',
                code: 'WIFI_UNAVAILABLE',
            });
        }

        console.error('[System] Failed to load Wi-Fi networks:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to load Wi-Fi networks',
            detail: error.detail || null,
            code: error.code || 'WIFI_SCAN_FAILED',
        });
    }
});

router.post('/wifi/connect', requireLogin, requireRole('admin'), async (req, res) => {
    if (!hostControl.isAvailable()) {
        return res.status(503).json({
            error: 'Wi-Fi controls are unavailable on this backend.',
            code: 'WIFI_UNAVAILABLE',
        });
    }

    const ssid = typeof req.body?.ssid === 'string' ? req.body.ssid : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : null;

    try {
        const result = await hostControl.connectWifi({
            ssid,
            password,
        });

        return res.status(202).json({
            ...result,
            requestedBy: req.session.user?.username || 'unknown',
        });
    } catch (error) {
        if (hostControl.isUnavailableError(error)) {
            return res.status(503).json({
                error: 'Wi-Fi controls are unavailable on this backend.',
                code: 'WIFI_UNAVAILABLE',
            });
        }

        console.error('[System] Failed to trigger Wi-Fi switch:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to switch Wi-Fi network',
            detail: error.detail || null,
            code: error.code || 'WIFI_CONNECT_FAILED',
        });
    }
});

router.post('/reboot', requireLogin, requireRole('admin'), async (req, res) => {
    const reboot = getRebootConfig();
    const username = req.session.user?.username || 'unknown';

    if (hostControl.isAvailable()) {
        try {
            const result = await hostControl.reboot();
            console.log(`[System] Host reboot requested by user ${username}.`);
            return res.status(202).json({
                ...result,
                source: result?.source || 'host-control',
            });
        } catch (error) {
            if (!hostControl.isUnavailableError(error)) {
                console.error('[System] Host control reboot failed:', error);
                if (!reboot.configured) {
                    return res.status(error.statusCode || 500).json({
                        error: error.message || 'Failed to launch reboot command',
                        detail: error.detail || null,
                        code: error.code || 'REBOOT_FAILED',
                    });
                }
            }
        }
    }

    if (!reboot.configured) {
        return res.status(503).json({ error: 'Reboot is not configured on this RoomSense backend.' });
    }

    try {
        const result = await launchConfiguredReboot(reboot, username);
        return res.status(202).json(result);
    } catch (error) {
        console.error('[System] Failed to launch reboot command:', error);
        return res.status(500).json({
            error: 'Failed to launch reboot command',
            detail: error.message || 'Unknown error',
        });
    }
});

export default router;
