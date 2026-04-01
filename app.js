const path = require('path');
const fs = require('fs')
const express = require('express');
const OS = require('os');
const bodyParser = require('body-parser');
const mongoose = require("mongoose");
const app = express();
const cors = require('cors')
const serverless = require('serverless-http')
const client = require('prom-client')

const register = new client.Registry()
client.collectDefaultMetrics({ register })

const planetRequestsCounter = new client.Counter({
    name: 'planet_requests_total',
    help: 'Total number of requests to the /planet endpoint',
    labelNames: ['planet_name'],
    registers: [register]
})

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [register]
})

const activeConnections = new client.Gauge({
    name: 'active_connections',
    help: 'Number of active connections being handled',
    registers: [register]
})


app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '/')));
app.use(cors())

app.use((req, res, next) => {
    activeConnections.inc()
    const start = Date.now()
    const end = httpRequestDuration.startTimer()
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000
        end({ method: req.method, route: req.path, status_code: res.statusCode })
        activeConnections.dec()
        console.log(`method=${req.method} path=${req.path} status=${res.statusCode} duration=${duration.toFixed(3)}s`)
    })
    next()
})

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI, {
        user: process.env.MONGO_USERNAME,
        pass: process.env.MONGO_PASSWORD,
        useNewUrlParser: true,
        useUnifiedTopology: true
    }, function(err) {
        if (err) {
            console.error(`mongo_connection_error error="${err.message}"`)
        } else {
            console.log("mongo_connected")
        }
    });
} else {
    console.log("mongo_not_configured running_without_db=true");
}

var Schema = mongoose.Schema;

var dataSchema = new Schema({
    name: String,
    id: Number,
    description: String,
    image: String,
    velocity: String,
    distance: String
});
var planetModel = mongoose.model('planets', dataSchema);



const planetsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'planets.json'), 'utf8'));

app.post('/planet', async function(req, res) {
    const start = Date.now()
    const delay = Math.floor(Math.random() * 5000);
    await new Promise(resolve => setTimeout(resolve, delay));

    if (!process.env.MONGO_URI) {
        const planet = planetsData.find(p => p.id === parseInt(req.body.id));
        const duration = (Date.now() - start) / 1000
        if (planet) {
            planetRequestsCounter.inc({ planet_name: planet.name })
            console.log(`planet_found id=${req.body.id} name=${planet.name} duration=${duration.toFixed(3)}s`)
        } else {
            console.warn(`planet_not_found id=${req.body.id} duration=${duration.toFixed(3)}s`)
        }
        return res.send(planet);
    }

    planetModel.findOne({ id: req.body.id }, function(err, planetData) {
        const duration = (Date.now() - start) / 1000
        if (err) {
            console.error(`planet_query_error id=${req.body.id} error="${err.message}" duration=${duration.toFixed(3)}s`)
            res.send("Error in Planet Data");
        } else {
            if (planetData) {
                planetRequestsCounter.inc({ planet_name: planetData.name })
                console.log(`planet_found id=${req.body.id} name=${planetData.name} source=mongodb duration=${duration.toFixed(3)}s`)
            } else {
                console.warn(`planet_not_found id=${req.body.id} source=mongodb duration=${duration.toFixed(3)}s`)
            }
            res.send(planetData);
        }
    });
});


app.get('/',   async (req, res) => {
    res.sendFile(path.join(__dirname, '/', 'index.html'));
});

app.get('/api-docs', (req, res) => {
    fs.readFile('oas.json', 'utf8', (err, data) => {
      if (err) {
        console.error(`api_docs_error error="${err.message}"`);
        res.status(500).send('Error reading file');
      } else {
        res.json(JSON.parse(data));
      }
    });
  });
  
app.get('/os',   function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send({
        "os": OS.hostname(),
        "env": process.env.NODE_ENV
    });
})

app.get('/live',   function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send({
        "status": "live"
    });
})

app.get('/ready',   function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send({
        "status": "ready"
    });
})

app.get('/metrics', async (req, res) => {
    res.setHeader('Content-Type', register.contentType)
    res.send(await register.metrics())
})

if (require.main === module) {
    app.listen(3000, () => {
        console.log(`solar_system starting hostname=${OS.hostname()} port=3000`);
    });
}

module.exports = app;


//module.exports.handler = serverless(app)