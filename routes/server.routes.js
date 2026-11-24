
const express = require("express");
const router = express.Router();

const {
  createServer,
  getServers,
  getServerById,
  updateServer,
  deleteServer,
  checkSlugAvailability,
  updateServerMonitoring,
  updateServerMetrics,
} = require("../controllers/server.controller");

const authenticator = require("../middlewares/authenticator.middleware");

// Server CRUD routes
router.post("/", authenticator(), createServer);
router.get("/", authenticator(), getServers);
router.get("/check-slug", authenticator(), checkSlugAvailability);
router.get("/:serverId", authenticator(), getServerById);
router.put("/:serverId", authenticator(), updateServer);
router.delete("/:serverId", authenticator(), deleteServer);
router.patch("/:serverId/monitoring", authenticator(), updateServerMonitoring);
router.patch("/:serverId/metrics", authenticator(), updateServerMetrics);

module.exports = router;
