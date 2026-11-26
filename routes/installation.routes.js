const express = require("express");
const {downloadRootfs, saveDeviceInfo, downloadPip, downloadNpm, downloadJdk, downloadPython, downloadCloudflareDebian12ARM64, downloadCloudflareDebian13ARM64} = require("../controllers/installation.controller");
const router = express.Router();
const authenticator = require("../middlewares/authenticator.middleware");

// Debian ARM64 Rootfs intallation
router.get("/getDebian", downloadRootfs);
router.post("/saveInfo", authenticator(), saveDeviceInfo);

// Runtime and Package Downloads
router.get("/getPip", downloadPip);
router.get("/getNpm", downloadNpm);
router.get("/getJdk", downloadJdk);
router.get("/getPython", downloadPython);
router.get("/getCloudflareDebian12ARM64", downloadCloudflareDebian12ARM64);
router.get("/getCloudflareDebian13ARM64", downloadCloudflareDebian13ARM64);

module.exports = router;