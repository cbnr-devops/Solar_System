const path = require('path');
const fs = require('fs')
const express = require('express');
const OS = require('os');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
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
    console.debug(`request_started method=${req.method} path=${req.path}`)
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000
        end({ method: req.method, route: req.path, status_code: res.statusCode })
        activeConnections.dec()
        if (res.statusCode >= 500) {
            console.error(`method=${req.method} path=${req.path} status=${res.statusCode} duration=${duration.toFixed(3)}s`)
        } else if (res.statusCode >= 400) {
            console.warn(`method=${req.method} path=${req.path} status=${res.statusCode} duration=${duration.toFixed(3)}s`)
        } else {
            console.log(`method=${req.method} path=${req.path} status=${res.statusCode} duration=${duration.toFixed(3)}s`)
        }
        if (duration > 3) {
            console.warn(`slow_request method=${req.method} path=${req.path} duration=${duration.toFixed(3)}s`)
        }
    })
    next()
})

let postgresPool = null
const usePostgres = Boolean(process.env.DATABASE_URL) || Boolean(process.env.POSTGRES_HOST)

if (usePostgres) {
    const poolConfig = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.POSTGRES_HOST,
            port: Number(process.env.POSTGRES_PORT || 5432),
            database: process.env.POSTGRES_DB || 'postgres',
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD
        }

    postgresPool = new Pool(poolConfig)
    postgresPool.connect((err, client, release) => {
        if (err) {
            console.error(`postgres_connection_error error="${err.message}"`)
            return
        }
        console.log('postgres_connected')
        release()
    })
} else {
    console.log('postgres_not_configured running_without_db=true')
}

const planetsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'planets.json'), 'utf8'));

app.post('/planet', async function(req, res) {
    const start = Date.now()
    console.debug(`planet_lookup_start id=${req.body.id}`)
    if (!req.body.id) {
        console.error(`missing_planet_id body=${JSON.stringify(req.body)}`)
        return res.status(400).send({ error: "Missing planet id" });
    }
    const parsedId = parseInt(req.body.id)
    if (isNaN(parsedId) || parsedId < 0) {
        console.error(`invalid_planet_id id=${req.body.id} reason=${isNaN(parsedId) ? 'not_a_number' : 'negative_id'}`)
        return res.status(400).send({ error: "Invalid planet id" });
    }
    const delay = Math.floor(Math.random() * 5000);
    await new Promise(resolve => setTimeout(resolve, delay));

    if (!process.env.MONGO_URI) {
        const planet = planetsData.find(p => p.id === parsedId);
        const duration = (Date.now() - start) / 1000
        if (planet) {
            planetRequestsCounter.inc({ planet_name: planet.name })
            console.log(`planet_found id=${req.body.id} name=${planet.name} duration=${duration.toFixed(3)}s`)
        } else {
            console.warn(`planet_not_found id=${req.body.id} duration=${duration.toFixed(3)}s`)
        }
        return res.send(planet);
    }

    try {
        const result = await postgresPool.query(
            'SELECT id, name, description, image, velocity, distance FROM planets WHERE id = $1 LIMIT 1',
            [parseInt(req.body.id, 10)]
        )
        const planetData = result.rows[0]
        const duration = (Date.now() - start) / 1000
        if (planetData) {
            planetRequestsCounter.inc({ planet_name: planetData.name })
            console.log(`planet_found id=${req.body.id} name=${planetData.name} source=postgresql duration=${duration.toFixed(3)}s`)
        } else {
            console.warn(`planet_not_found id=${req.body.id} source=postgresql duration=${duration.toFixed(3)}s`)
        }
        res.send(planetData);
    } catch (err) {
        const duration = (Date.now() - start) / 1000
        console.error(`planet_query_error id=${req.body.id} error="${err.message}" duration=${duration.toFixed(3)}s`)
        res.send("Error in Planet Data");
    }
});


app.get('/',   async (req, res) => {
    console.debug(`serving_index client_ip=${req.ip}`)
    res.sendFile(path.join(__dirname, '/', 'index.html'));
});

app.get('/api-docs', (req, res) => {
    console.debug("api_docs_requested")
    fs.readFile('oas.json', 'utf8', (err, data) => {
      if (err) {
        console.error(`api_docs_error error="${err.message}"`);
        res.status(500).send('Error reading file');
      } else {
        console.debug(`api_docs_served size=${data.length}bytes`)
        res.json(JSON.parse(data));
      }
    });
  });
  
app.get('/os',   function(req, res) {
    console.debug(`os_info_requested hostname=${OS.hostname()}`)
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
        console.debug(`loaded ${planetsData.length} planets from planets.json`)
        console.debug(`environment=${process.env.NODE_ENV || 'development'} mongo_configured=${!!process.env.MONGO_URI}`)
    });
}

module.exports = app;


//module.exports.handler = serverless(app)