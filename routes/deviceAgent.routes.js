
const express = require("express");

const router = express.Router();

const authenticator = require("../middlewares/authenticator.middleware");

const controller = require("../controllers/deviceAgent.controller");

const {
  authenticateAgentToken,
} = require("../services/hosting.service");


// Device-agent authentication middleware.
const agentAuthentication = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      const error = new Error(
        "Device-agent Bearer token is required."
      );

      error.statusCode = 401;
      error.code = "AGENT_TOKEN_REQUIRED";

      throw error;
    }

    const token = authorization.slice(7).trim();

    req.agent = await authenticateAgentToken(token);

    next();
  } catch (error) {
    next(error);
  }
};


// USER-AUTHENTICATED ENDPOINTS

// Generate or rotate a device-agent credential.
router.post(
  "/provision/:deviceId",
  authenticator(),
  controller.provisionDeviceAgent
);

// Queue a command for an assigned device.
router.post(
  "/commands",
  authenticator(),
  controller.queueCommand
);


// DEVICE-AGENT-AUTHENTICATED ENDPOINTS

router.use(agentAuthentication);

// Heartbeat.
router.post(
  "/heartbeat",
  controller.heartbeat
);

// Fetch assigned server configuration.
router.get(
  "/config",
  controller.getConfiguration
);

// Poll pending commands.
router.get(
  "/commands",
  controller.pollCommands
);

// Report command execution result.
router.post(
  "/commands/:commandId/result",
  controller.commandResult
);

// Register or replace the Quick Tunnel URL.
router.post(
  "/servers/:serverId/tunnel",
  controller.updateTunnel
);

// Fetch environment configuration for an assigned server.
router.get(
  "/servers/:serverId/environment",
  controller.getServerEnvironment
);


module.exports = router;
