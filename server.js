require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const path = require('path'); // Added path module
const saveRoutes = require('./routes/saveFiles');
const pinoHttp = require('pino-http');
const logger = require('./config/logger'); // Import shared logger
const client = require('prom-client'); // prom-client

const app = express();
const port = process.env.PORT || 3000;

// Initialize Logger (Pino)
const httpLogger = pinoHttp({
  logger: logger, // Use the shared logger instance
  autoLogging: false, // Disable automatic logging of req/res

  // If you still wanted a very brief summary line, you could keep autoLogging: true
  // and provide custom serializers to drastically reduce req/res content, e.g.:
  // serializers: {
  //   req: (req) => ({ method: req.method, url: req.url, id: req.id }),
  //   res: (res) => ({ statusCode: res.statusCode })
  // }
});

// Setup View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve Static Files (CSS, Client-side JS)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(httpLogger); // Use pino-http for request logging
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// --- Prometheus Metrics Setup ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'supabase_cloud_save_backend:' }); // Add a prefix to identify your app's metrics

// Optional: Create a custom histogram for request durations (more advanced)
// const httpRequestDurationMicroseconds = new client.Histogram({
//   name: 'http_request_duration_ms',
//   help: 'Duration of HTTP requests in ms',
//   labelNames: ['method', 'route', 'code'],
//   buckets: [50, 100, 200, 300, 400, 500, 1000, 2000] // buckets for response time from 50ms to 2s
// });
// app.use((req, res, next) => {
//   const end = httpRequestDurationMicroseconds.startTimer();
//   res.on('finish', () => {
//      // Dynamically get route, handle cases where req.route might be undefined for 404s etc.
//     const route = req.route ? req.route.path : (req.baseUrl || '') + (req.path || '');
//     end({ route: route, code: res.statusCode, method: req.method });
//   });
//   next();
// });
// --- End Prometheus Metrics Setup ---

// Routes
app.use('/api/saves', saveRoutes); // All save-related routes will be under /api/saves

// UI Route
app.get('/', (req, res) => {
  // Pass Supabase config to the client-side through EJS
  res.render('index', {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (ex) {
    logger.error({ err: ex }, 'Error serving metrics');
    res.status(500).end(ex.toString());
  }
});

// Basic Error Handling Middleware
app.use((err, req, res, next) => {
  // Log the error using pino. req.log is available from pino-http (which uses our shared logger)
  // or fallback to the shared logger directly if req.log is not populated for some reason.
  const errorLogger = req.log || logger;
  errorLogger.error({ err: err, stack: err.stack }, 'Unhandled error caught by error handler');

  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// Start the server
app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    logger.warn('WARNING: SUPABASE_URL or SUPABASE_ANON_KEY is not set. Backend may not function correctly.');
  }
});

// Pass the main logger to other modules if needed, e.g. by exporting it
// module.exports.logger = logger;
