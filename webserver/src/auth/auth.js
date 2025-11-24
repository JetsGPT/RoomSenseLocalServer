

function requireLogin(req, res, next) {
    // Dev mode bypass - set DEV_BYPASS_AUTH=1 in .env to skip authentication
    if (process.env.DEV_BYPASS_AUTH === '1') {
        // Create a fake user session for dev mode
        if (!req.session.user) {
            req.session.user = {
                id: 'dev-user',
                username: 'dev',
                role: 'user'
            };
        }
        return next();
    }
    
    if (!req.session.user) {
        return res.status(401).send({ error: 'You must be logged in' });
    }
    next();
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).send({ error: 'You must be logged in' });
        }
        if (req.session.user.role !== role) {
            return res.status(403).send({ error: 'Forbidden: insufficient rights' });
        }
        next();
    };
}
export {requireLogin, requireRole};