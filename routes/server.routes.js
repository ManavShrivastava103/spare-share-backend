
const express = require("express");
const router = express.Router();

const {
  createServer,
  getServers,
  getServerById,
  updateServer,
  deleteServer,
} = require("../controllers/server.controller");

const authenticator = require("../middlewares/authenticator.middleware");

// Server CRUD routes
router.post("/", authenticator(), createServer);
router.get("/", authenticator(), getServers);
router.get("/:serverId", authenticator(), getServerById);
router.patch("/:serverId", authenticator(), updateServer);
router.delete("/:serverId", authenticator(), deleteServer);

module.exports = router;
