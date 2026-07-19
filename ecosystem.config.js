"use strict";

module.exports = {
  apps: [
    {
      name: "starforge-5d",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      restart_delay: 2000,
      max_memory_restart: "300M",
      kill_timeout: 6000,
      time: true,
      env_production: {
        NODE_ENV: "production",
        PORT: 4050,
      },
    },
  ],
};
