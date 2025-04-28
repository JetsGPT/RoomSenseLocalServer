import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 8081   ;

import userRouter from './routes/users.js';
import sensorRouter from './routes/sensors.js';
import testingRouter from './routes/testing.js';

app.use(express.json());
app.use(cors({
    origin: '*',
}));
app.use('/api/users', userRouter);
app.use('/api/sensors', sensorRouter);
app.use('/testing', testingRouter);


app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});