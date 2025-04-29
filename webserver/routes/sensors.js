import express from 'express';
import influx from '@influxdata/influxdb-client';

const router = express.Router();

const token = process.env.INFLUX_TOKEN;
const url = process.env.INFLUX_URL;
const organisation = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

const influxClient = new influx.InfluxDB({url, token})



router.get('/data', (req, res) => {
    console.log("A read attempt has been made");
    let response = '';  // Initialize as an empty string
    let queryClient = influxClient.getQueryApi(organisation);
    let fluxQuery = `from(bucket: "${bucket}")
 |> range(start: -10m)
 |> filter(fn: (r) => r._measurement == "measurement1")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            response += JSON.stringify(tableObject); // Append JSON string with a newline
        },
        error: (error) => {
            res.status(500).send('Error getting data.');
            console.log("A read attempt has failed");
        },
        complete: () => {
            res.status(200).json(response || 'No data found'); // Prevent empty response
            console.log("A read attempt has succeeded")
        },
    });
});

router.get('/writeTestData', (req,res)=> {
    try {
        writeTestData();
        res.status(200).send('Test Data has been written.')
    }
    catch (err) {
        res.status(400).send(err)
    }
})

router.get('/ping', async (req, res) => {
    try {
        await influxClient.ping(5000)
        res.status(200).send("It worked")
    }
    catch (err){
        res.status(500).send(err.message || 'Unknown error');

    }
})

router.get('/', (req, res) => {
    console.log("Hello World has been sent.")
    res.status(200).send("Hello World!")
});


function writeTestData(){
    let writeClient = influxClient.getWriteApi(organisation, bucket, 'ns')

    for (let i = 0; i < 5; i++) {
        let point = new influx.Point('measurement1')
            .tag('tagname1', 'tagvalue1')
            .intField('field1', i)

        void setTimeout(() => {
            writeClient.writePoint(point)
        }, i * 1000) // separate points by 1 second

        void setTimeout(() => {
            writeClient.flush()
        }, 5000)
    }
}


export default router;