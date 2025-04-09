import express from 'express';

const router = express.Router();

import { InfluxDB, Point } from '@influxdata/influxdb-client';

const token = 'TR6vWva87Bs1YGnAEQlR2gmO-inil9P_rUqNMhS1GQfgo97zBAapEx9_S4vOIwRKS6LS82vNWPpej6alqpGX-A=='
const url = 'http://localhost:8086'

const influxClient = new InfluxDB({url, token})



router.get('/sensor/data', (req, res) => {
    console.log("A read attempt has been made");
    let response = '';  // Initialize as an empty string
    let org = `RoomSense`;
    let queryClient = influxClient.getQueryApi(org);
    let fluxQuery = `from(bucket: "Temp")
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


function writeTestData(){
    let org = `RoomSense`
    let bucket = `Temp`

    let writeClient = influxClient.getWriteApi(org, bucket, 'ns')

    for (let i = 0; i < 5; i++) {
        let point = new Point('measurement1')
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