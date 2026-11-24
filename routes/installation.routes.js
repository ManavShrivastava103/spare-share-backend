const express = require("express");
const {downloadRootfs, saveDeviceInfo, downloadPip, downloadNpm, downloadJdk, downloadPython} = require("../controllers/installation.controller");
const router = express.Router();
const authenticator = require("../middlewares/authenticator.middleware");

// Debian ARM64 Rootfs intallation
router.get("/getDebian", authenticator(), downloadRootfs);
router.post("/saveInfo", authenticator(), saveDeviceInfo);

// Runtime and Package Downloads
router.get("/getPip", authenticator(), downloadPip);
router.get("/getNpm", authenticator(), downloadNpm);
router.get("/getJdk", authenticator(), downloadJdk);
router.get("/getPython", authenticator(), downloadPython);

module.exports = router;