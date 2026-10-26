const express = require("express");
const {downloadRootfs, saveDeviceInfo} = require("../controllers/installation.controller");
const router = express.Router();
const authenticator = require("../middlewares/authenticator.middleware");

// Debian ARM64 Rootfs intallation
router.get("/getDebian", authenticator(), downloadRootfs);
router.post("/saveInfo", authenticator(), saveDeviceInfo);

module.exports = router;