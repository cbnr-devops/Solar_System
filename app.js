const path = require('path');
const fs = require('fs')
const express = require('express');
const OS = require('os');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const app = express();
const cors = require('cors')
const serverless = require('serverless-http')
const client = require('prom-client')

const log = {
    _emit(level, msg, extra = {}) {
        const entry = { msg, ...extra }
        process.stdout.write(JSON.stringify(entry) + '\n')
    },
    debug(msg, extra) { this._emit('debug', msg, extra) },
    info(msg, extra) { this._emit('info', msg, extra) },
    warn(msg, extra) { this._emit('warning', msg, extra) },
    error(msg, extra) { this._emit('error', msg, extra) },
}

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

const planetDataSourceCounter = new client.Counter({
    name: 'planet_data_source_total',
    help: 'Total planet lookups by data source',
    labelNames: ['source'],
    registers: [register]
})

const planetDbLookupErrorsCounter = new client.Counter({
    name: 'planet_db_lookup_errors_total',
    help: 'Total failed DB lookups for planets',
    registers: [register]
})

const planetDbLookupDuration = new client.Histogram({
    name: 'planet_db_lookup_duration_seconds',
    help: 'Duration of planet DB queries in seconds',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [register]
})


app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '/')));
app.use(cors())

app.use((req, res, next) => {
    const traceId = req.headers['x-trace-id'] || crypto.randomBytes(8).toString('hex')
    req.traceId = traceId
    res.setHeader('X-Trace-Id', traceId)
    next()
})

app.use((req, res, next) => {
    activeConnections.inc()
    const start = Date.now()
    const end = httpRequestDuration.startTimer()
    log.debug('request_started', { trace_id: req.traceId, method: req.method, path: req.path })
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000
        end({ method: req.method, route: req.path, status_code: res.statusCode })
        activeConnections.dec()
        const meta = { trace_id: req.traceId, method: req.method, path: req.path, status: res.statusCode, duration: `${duration.toFixed(3)}s` }
        if (res.statusCode >= 500) {
            log.error('request_completed', meta)
        } else if (res.statusCode >= 400) {
            log.warn('request_completed', meta)
        } else {
            log.info('request_completed', meta)
        }
        if (duration > 3) {
            log.warn('slow_request', { trace_id: req.traceId, method: req.method, path: req.path, duration: `${duration.toFixed(3)}s` })
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
            database: process.env.POSTGRES_DB || 'solar-system',
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            ssl: { rejectUnauthorized: false }
        }

    postgresPool = new Pool(poolConfig)
    postgresPool.connect((err, client, release) => {
        if (err) {
            log.error('postgres_connection_error', { error: err.message })
            return
        }
        log.info('postgres_connected')
        release()
    })
} else {
    log.info('postgres_not_configured', { running_without_db: true })
}

const planetsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'planets.json'), 'utf8'));

app.post('/planet', async function(req, res) {
    const start = Date.now()
    const traceId = req.traceId
    log.debug('planet_lookup_start', { trace_id: traceId, id: req.body.id })
    if (!req.body.id) {
        log.error('missing_planet_id', { trace_id: traceId, body: req.body })
        return res.status(400).send({ error: "Missing planet id" });
    }
    const parsedId = parseInt(req.body.id)
    if (isNaN(parsedId) || parsedId < 0) {
        log.error('invalid_planet_id', { trace_id: traceId, id: req.body.id, reason: isNaN(parsedId) ? 'not_a_number' : 'negative_id' })
        return res.status(400).send({ error: "Invalid planet id" });
    }
    const delay = Math.floor(Math.random() * 5000);
    await new Promise(resolve => setTimeout(resolve, delay));

    if (postgresPool) {
        const dbStart = Date.now()
        log.debug('db_lookup_start', { trace_id: traceId, id: parsedId })
        try {
            const result = await postgresPool.query(
                'SELECT id, name, description, image, velocity, distance FROM planets WHERE id = $1 LIMIT 1',
                [parsedId]
            )
            const dbDuration = (Date.now() - dbStart) / 1000
            planetDbLookupDuration.observe(dbDuration)
            const planetData = result.rows[0]
            if (planetData) {
                planetDataSourceCounter.inc({ source: 'db' })
                planetRequestsCounter.inc({ planet_name: planetData.name })
                const duration = (Date.now() - start) / 1000
                log.info('db_lookup_hit', { trace_id: traceId, id: parsedId, name: planetData.name })
                log.info('planet_found', { trace_id: traceId, id: parsedId, name: planetData.name, source: 'db', duration: `${duration.toFixed(3)}s` })
                return res.send(planetData);
            } else {
                log.warn('db_lookup_miss', { trace_id: traceId, id: parsedId })
            }
        } catch (err) {
            const dbDuration = (Date.now() - dbStart) / 1000
            planetDbLookupDuration.observe(dbDuration)
            planetDbLookupErrorsCounter.inc()
            log.error('db_lookup_failed', { trace_id: traceId, id: parsedId, error: err.message })
            log.info('db_fallback', { trace_id: traceId, id: parsedId })
        }
    }

    const planet = planetsData.find(p => p.id === parsedId);
    const duration = (Date.now() - start) / 1000
    if (planet) {
        planetDataSourceCounter.inc({ source: 'json' })
        planetRequestsCounter.inc({ planet_name: planet.name })
        log.info('planet_found', { trace_id: traceId, id: parsedId, name: planet.name, source: 'json', duration: `${duration.toFixed(3)}s` })
    } else {
        log.warn('planet_not_found', { trace_id: traceId, id: parsedId, source: 'json', duration: `${duration.toFixed(3)}s` })
    }
    return res.send(planet);
});


app.get('/',   async (req, res) => {
    log.debug('serving_index', { trace_id: req.traceId, client_ip: req.ip })
    res.sendFile(path.join(__dirname, '/', 'index.html'));
});

app.get('/api-docs', (req, res) => {
    log.debug('api_docs_requested', { trace_id: req.traceId })
    fs.readFile('oas.json', 'utf8', (err, data) => {
      if (err) {
        log.error('api_docs_error', { trace_id: req.traceId, error: err.message });
        res.status(500).send('Error reading file');
      } else {
        log.debug('api_docs_served', { trace_id: req.traceId, size: `${data.length}bytes` })
        res.json(JSON.parse(data));
      }
    });
  });

app.get('/os',   function(req, res) {
    log.debug('os_info_requested', { trace_id: req.traceId, hostname: OS.hostname() })
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
        log.info('solar_system_starting', { hostname: OS.hostname(), port: 3000 });
        log.debug('planets_loaded', { count: planetsData.length, source: 'planets.json' })
        log.debug('environment', { node_env: process.env.NODE_ENV || 'development', mongo_configured: !!process.env.MONGO_URI })
    });
}

module.exports = app;


//module.exports.handler = serverless(app)