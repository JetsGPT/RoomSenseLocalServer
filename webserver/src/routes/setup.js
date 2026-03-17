import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

/**
 * Helper to check if setup is already completed.
 */
async function isSetupCompleted(pool) {
    try {
        const result = await pool.query("SELECT value FROM system_settings WHERE key = 'setup_completed'");
        if (result.rows.length > 0) {
            return result.rows[0].value === 'true';
        }
        return false;
    } catch (err) {
        // Table might not exist or network issue; assume false so setup can proceed/fix it
        return false;
    }
}

/**
 * GET /api/setup/status
 * Returns { completed: boolean }
 */
router.get('/status', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        if (!pool) {
             return res.status(503).json({ error: 'Database not initialized' });
        }
        const completed = await isSetupCompleted(pool);
        res.status(200).json({ completed });
    } catch (error) {
        console.error('[Setup] Error checking status:', error);
        res.status(500).json({ error: 'Failed to check setup status' });
    }
});

/**
 * GET /api/setup/credentials
 * Reads the generated credentials.txt file created by the init scripts.
 * ONLY accessible if setup is NOT completed.
 */
router.get('/credentials', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const completed = await isSetupCompleted(pool);
        
        if (completed) {
            return res.status(403).json({ error: 'Setup already completed. Credentials are no longer accessible.' });
        }

        const credentialsPath = path.join(process.cwd(), 'setup', 'credentials.txt');
        
        if (!fs.existsSync(credentialsPath)) {
            return res.status(404).json({ error: 'Credentials file not found. It may have already been deleted or was never generated.' });
        }

        const credentialsData = fs.readFileSync(credentialsPath, 'utf8');
        res.status(200).send(credentialsData);

    } catch (error) {
        console.error('[Setup] Error reading credentials:', error);
        res.status(500).json({ error: 'Failed to read credentials' });
    }
});

/**
 * GET /api/setup/certificate
 * Downloads the rootCA.crt file so the user can trust the local certificate.
 */
router.get('/certificate', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const completed = await isSetupCompleted(pool);
        
        if (completed) {
            // Depending on security preference, you might want this always available
            // but for a strict setup flow we restrict it to incomplete setups.
            return res.status(403).json({ error: 'Setup already completed. Certificate download is disabled.' });
        }

        const certPath = path.join(process.cwd(), 'certs', 'rootCA.crt');
        
        if (!fs.existsSync(certPath)) {
            return res.status(404).json({ error: 'Certificate file not found.' });
        }

        res.download(certPath, 'RoomSense_RootCA.crt');
    } catch (error) {
        console.error('[Setup] Error sending certificate:', error);
        res.status(500).json({ error: 'Failed to download certificate' });
    }
});

/**
 * POST /api/setup/complete
 * Marks the setup as completed in the database and securely deletes the credentials.txt file.
 */
router.post('/complete', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const completed = await isSetupCompleted(pool);
        
        if (completed) {
            return res.status(400).json({ error: 'Setup is already marked as completed.' });
        }

        // Delete the credentials file
        const credentialsPath = path.join(process.cwd(), 'setup', 'credentials.txt');
        if (fs.existsSync(credentialsPath)) {
            try {
                // Securely delete (overwrite with zeros then unlink, simple version)
                const stats = fs.statSync(credentialsPath);
                const fd = fs.openSync(credentialsPath, 'r+');
                const zeros = Buffer.alloc(stats.size, 0);
                fs.writeSync(fd, zeros, 0, stats.size, 0);
                fs.closeSync(fd);
                fs.unlinkSync(credentialsPath);
                console.log('[Setup] Successfully deleted credentials file.');
            } catch (err) {
                console.error('[Setup] Error deleting credentials file:', err);
                // Do we fail the request? Probably not, but we should log heavily.
            }
        }

        // Mark as completed in DB
        await pool.query(
            `INSERT INTO system_settings (key, value, description) 
             VALUES ('setup_completed', 'true', 'System Guided Setup has been completed') 
             ON CONFLICT (key) DO UPDATE SET value = 'true'`
        );

        res.status(200).json({ success: true });

    } catch (error) {
        console.error('[Setup] Error completing setup:', error);
        res.status(500).json({ error: 'Failed to complete setup' });
    }
});

export default router;
