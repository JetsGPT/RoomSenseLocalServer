import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { requireLogin, requireRole } from '../auth/auth.js';

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

router.get('/info', requireLogin, (req, res) => {
    const reboot = getRebootConfig();
    const frontendBuildPresent = Boolean(req.app.locals.hasFrontendBuild?.());

    res.status(200).json({
        backendVersion: readBackendVersion(),
        rebootSupported: reboot.supported,
        rebootConfigured: reboot.configured,
        rebootLabel: reboot.label,
        frontendBuildPresent,
    });
});

router.post('/reboot', requireLogin, requireRole('admin'), async (req, res) => {
    const reboot = getRebootConfig();

    if (!reboot.configured) {
        return res.status(503).json({ error: 'Reboot is not configured on this RoomSense backend.' });
    }

    try {
        const child = spawn(reboot.command, reboot.args, {
            detached: true,
            stdio: 'ignore',
        });

        await new Promise((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
        });

        child.unref();

        console.log(`[System] Reboot command launched by user ${req.session.user?.username || 'unknown'}.`);
        return res.status(202).json({
            status: 'rebooting',
            message: `${reboot.label} command launched.`,
        });
    } catch (error) {
        console.error('[System] Failed to launch reboot command:', error);
        return res.status(500).json({
            error: 'Failed to launch reboot command',
            detail: error.message || 'Unknown error',
        });
    }
});

export default router;
