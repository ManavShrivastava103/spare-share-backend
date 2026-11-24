// require("dotenv").config();

// const express = require("express");
// const connectDB = require("./config/db.config");

// const authRoutes = require("./routes/auth.routes");
// const installationRoutes = require("./routes/installation.routes");
// const serverRoutes = require("./routes/server.routes");
// const githubRoutes = require("./routes/github.routes");
// const serverEndpointRoutes = require("./routes/serverEndpoint.routes");

// const serverEndpointController = require("./controllers/serverEndpoint.controller");

// const errorMiddleware = require("./middlewares/error.middleware");
// const initializeCounters = require("./services/counter.service");

// const app = express();
// const PORT = process.env.PORT || 5000;

// // Public permanent endpoint routes
// // IMPORTANT: Keep these BEFORE body-parsing middleware.

// app.all("/s/:permanentId", serverEndpointController.proxyTraffic);
// app.all("/s/:permanentId/*path", serverEndpointController.proxyTraffic);

// // Middleware
// app.use(
//   express.json({
//     verify: (req, res, buffer) => {
//       if (req.originalUrl.split("?")[0] === "/api/github/webhook") {
//         req.rawBody = Buffer.from(buffer);
//       }
//     },
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // Database
// connectDB();

// // Initialize counters
// initializeCounters();

// // Routes
// app.use("/api/auth", authRoutes);
// app.use("/api/setup", installationRoutes);
// app.use("/api/server", serverRoutes);
// app.use("/api/github", githubRoutes);

// // Server Endpoint management routes
// app.use("/api/server-endpoint", serverEndpointRoutes);

// // Health Check
// app.get("/", (req, res) => {
//   return res.status(200).json({success: true, message: "SpareShare API is running.",});
// });

// // Error Middleware
// app.use(errorMiddleware);

// // Start Server
// app.listen(PORT, () => {console.log(`Server running on port ${PORT}`)});








require("dotenv").config();

const express = require("express");

const connectDB = require("./config/db.config");

const authRoutes = require("./routes/auth.routes");
const installationRoutes = require("./routes/installation.routes");
const serverRoutes = require("./routes/server.routes");
const githubRoutes = require("./routes/github.routes");
const serverEndpointRoutes = require("./routes/serverEndpoint.routes");
const deviceAgentRoutes = require("./routes/deviceAgent.routes");
const serverEndpointController = require("./controllers/serverEndpoint.controller");
const serverEnvironmentRoutes = require("./routes/serverEnvironment.routes");

const errorMiddleware = require("./middlewares/error.middleware");
const initializeCounters = require("./services/counter.service");

const {
  startMonitoringScheduler,
} = require("./services/hosting.service");


const app = express();
const PORT = process.env.PORT || 5000;

let stopMonitoringScheduler = () => {};
let isShuttingDown = false;


// PUBLIC PERMANENT ENDPOINT ROUTES
// Keep these before body-parsing middleware.

app.all(
  "/s/:permanentId",
  serverEndpointController.proxyTraffic
);

app.all(
  "/s/:permanentId/*path",
  serverEndpointController.proxyTraffic
);


// MIDDLEWARE

app.use(
  express.json({
    limit: "1mb",

    verify: (req, res, buffer) => {
      if (req.originalUrl.split("?")[0] === "/api/github/webhook") {
        req.rawBody = Buffer.from(buffer);
      }
    },
  })
);

app.use(express.urlencoded({ extended: true }));


// API ROUTES

app.use("/api/auth", authRoutes);
app.use("/api/setup", installationRoutes);
app.use("/api/server", serverRoutes);
app.use("/api/github", githubRoutes);
app.use("/api/server-endpoint", serverEndpointRoutes);
app.use("/api/device-agent", deviceAgentRoutes);
app.use("/api/server-env", serverEnvironmentRoutes);


// HEALTH CHECK

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "SpareShare API is running.",
  });
});


// ERROR MIDDLEWARE

app.use(errorMiddleware);


// GRACEFUL SHUTDOWN

const shutdown = (server, signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(`${signal} received. Shutting down SpareShare...`);

  stopMonitoringScheduler();

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};


// START SERVER AFTER DATABASE INITIALIZATION

const startServer = async () => {
  try {
    await connectDB();

    await initializeCounters();

    const server = app.listen(PORT, () => {
      console.log(`SpareShare API running on port ${PORT}`);
    });

    // Start monitoring only after MongoDB is ready.
    stopMonitoringScheduler = startMonitoringScheduler();

    process.on("SIGTERM", () => {
      shutdown(server, "SIGTERM");
    });

    process.on("SIGINT", () => {
      shutdown(server, "SIGINT");
    });

  } catch (error) {
    console.error(
      "SpareShare startup failed:",
      error
    );

    process.exit(1);
  }
};


startServer();
