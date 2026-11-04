
const express = require("express");
const router = express.Router();

const {
  createServer,
  getServers,
  getServerById,
  updateServer,
  deleteServer,
  checkSlugAvailability,
} = require("../controllers/server.controller");

const authenticator = require("../middlewares/authenticator.middleware");

// Server CRUD routes
router.post("/", authenticator(), createServer);
router.get("/", authenticator(), getServers);
router.get("/:serverId", authenticator(), getServerById);
router.put("/:serverId", authenticator(), updateServer);
router.delete("/:serverId", authenticator(), deleteServer);
router.get("/check-slug", authenticator(), checkSlugAvailability);

module.exports = router;
