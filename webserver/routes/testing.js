import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
    console.log("Hello World has been sent.")
    res.send('Hello, World!');
});

export default router;