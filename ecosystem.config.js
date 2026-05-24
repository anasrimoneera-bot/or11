// PM2 配置 - 提高 Node 堆内存避免大 xlsx 解析 OOM
// 总表上传(exceljs 流式)会把共享字符串载入内存，170MB+ 文件峰值可达数 GB。
// 服务器 16GB 物理内存，堆设 12GB(留 ~4GB 给系统/其它进程/Node 非堆开销)。
// 注意：部分 pm2 版本不认 node_args 字符串写法，故用数组 + NODE_OPTIONS 双保险，
//       NODE_OPTIONS 是 Node 启动必读的环境变量，最可靠。
module.exports = {
  apps: [{
    name: 'lanjing-erp',
    script: 'server/index.js',
    cwd: __dirname,
    node_args: ['--max-old-space-size=12288'],
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=12288',
    },
    autorestart: true,
    max_restarts: 10,
    min_uptime: 5000,
  }],
};
