

function requireLogin(req, res, next) {
    // Auth bypass removed
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
export { requireLogin, requireRole };