import express from 'express';
import dataRetrievalRouter from './dataRetrieval.js';
import dataWritingRouter from './dataWriting.js';

const router = express.Router();

// Health check endpoint
router.get('/', (req, res) => {
    console.log("Sensors API endpoint accessed");
    res.status(200).json({ message: "Sensors API is running" });
});

// Mount sub-routers
router.use('/', dataRetrievalRouter);
router.use('/', dataWritingRouter);

export default router;
