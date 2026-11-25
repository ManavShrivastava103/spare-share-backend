const express = require("express");
const router = express.Router();

const {proxyTraffic} = require("../controllers/serverEndpoint.controller");

// PUBLIC REVERSE PROXY
router.all("/s/:permanentId", proxyTraffic);
router.all("/s/:permanentId/*path", proxyTraffic);

module.exports = router;