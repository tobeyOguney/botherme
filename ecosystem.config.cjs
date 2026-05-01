module.exports = {
  apps: [
    {
      name: "botherme",
      script: "node",
      args: "--import tsx src/index.ts",
      instances: 1,
      autorestart: true,
      max_restarts: 5,
      min_uptime: "60s",
      env: { NODE_ENV: "production" },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      time: true,
    },
  ],
};
