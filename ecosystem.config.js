// PM2 配置 - 提高 Node 堆内存避免大 xlsx 解析 OOM
// 总表上传 (XLSX.readFile) 90MB 文件解析峰值约 1GB+ 内存
module.exports = {
  apps: [{
    name: 'lanjing-erp',
    script: 'server/index.js',
    cwd: __dirname,
    node_args: '--max-old-space-size=4096',
    env: { NODE_ENV: 'production' },
    autorestart: true,
    max_restarts: 10,
    min_uptime: 5000,
  }],
};
