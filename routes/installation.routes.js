const express = require("express");
const {downloadRootfs} = require("../controllers/installation.controller");
const router = express.Router();

// Debian ARM64 Rootfs
router.get("/rootfs", downloadRootfs);

module.exports = router;