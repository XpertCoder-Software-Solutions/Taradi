module.exports = {
  apps: [
    {
      name: "taradi-api",
      script: "src/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
      env: {
        NODE_ENV: "production"
      },
      error_file: "./logs/taradi-api-error.log",
      out_file: "./logs/taradi-api-out.log",
      merge_logs: true
    },
    {
      name: "taradi-whatsapp-worker",
      script: "src/workers/whatsapp.worker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
      env: {
        NODE_ENV: "production"
      },
      error_file: "./logs/taradi-whatsapp-worker-error.log",
      out_file: "./logs/taradi-whatsapp-worker-out.log",
      merge_logs: true
    },
    {
      name: "taradi-webhook-worker",
      script: "src/workers/whatsapp-webhook.worker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      restart_delay: 3000,
      time: true,
      env: {
        NODE_ENV: "production"
      },
      error_file: "./logs/taradi-webhook-worker-error.log",
      out_file: "./logs/taradi-webhook-worker-out.log",
      merge_logs: true
    },
    {
      name: "taradi-campaign-prepare-worker",
      script: "src/workers/campaign-prepare.worker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
      env: { NODE_ENV: "production" },
      error_file: "./logs/taradi-campaign-prepare-worker-error.log",
      out_file: "./logs/taradi-campaign-prepare-worker-out.log",
      merge_logs: true
    },
    {
      name: "taradi-campaign-send-worker",
      script: "src/workers/campaign-send.worker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      restart_delay: 3000,
      time: true,
      env: { NODE_ENV: "production" },
      error_file: "./logs/taradi-campaign-send-worker-error.log",
      out_file: "./logs/taradi-campaign-send-worker-out.log",
      merge_logs: true
    }
  ]
};
