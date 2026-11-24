
const express = require("express");
const router = express.Router();

const authenticator = require("../middlewares/authenticator.middleware");
const controller = require("../controllers/serverEndpoint.controller");

// Endpoint management
router.post("/:serverId", authenticator(), controller.createServerEndpoint);
router.get("/", authenticator(), controller.getServerEndpoints);
router.get("/:serverId", authenticator(), controller.getServerEndpoint);

// Redirection link management
router.post("/:serverId/redirection-links", authenticator(), controller.addRedirectionLink);
router.patch("/:serverId/redirection-links/:deviceId", authenticator(), controller.updateRedirectionLink);
router.delete("/:serverId/redirection-links/:deviceId", authenticator(), controller.removeRedirectionLink);

// Routing configuration
router.patch("/:serverId/routing-mode", authenticator(), controller.updateRoutingMode);
router.patch("/:serverId/security", authenticator(), controller.updateEndpointSecurity);
router.patch("/:serverId/status", authenticator(), controller.updateEndpointStatus);

// Delete endpoint
router.delete("/:serverId", authenticator(), controller.deleteServerEndpoint);

module.exports = router;
