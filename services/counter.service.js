const Counter = require("../models/counter.model");

const initializeCounters = async () => {
  await Counter.updateOne(
    { _id: "deviceId" },
    {
      $setOnInsert: {
        sequence: 0,
      },
    },
    {
      upsert: true,
    }
  );

  console.log("Device ID counter initialized.");
};

module.exports = initializeCounters;
