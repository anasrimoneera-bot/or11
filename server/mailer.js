// SMTP 邮件发送（用于 BOSS 账号密码找回验证码）。
// SMTP 参数由店主在 系统设置 → 邮件(SMTP)设置 中维护，存 settings 表。
// nodemailer 发送是异步的，不会阻塞事件循环。
const nodemailer = require('nodemailer');
const { getSetting } = require('./settings');

function getSmtpConfig() {
  return {
    host: (getSetting('smtp_host') || '').trim(),
    port: Number(getSetting('smtp_port')) || 465,
    secure: getSetting('smtp_secure') !== '0', // 默认 SSL(465)；587 STARTTLS 时设为 0
    user: (getSetting('smtp_user') || '').trim(),
    pass: getSetting('smtp_pass') || '',
    from: (getSetting('smtp_from') || '').trim(),
  };
}

function isSmtpConfigured() {
  const c = getSmtpConfig();
  return !!(c.host && c.user && c.pass);
}

async function sendMail({ to, subject, text }) {
  const c = getSmtpConfig();
  if (!c.host || !c.user || !c.pass) throw new Error('SMTP 未配置');
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  try {
    return await transporter.sendMail({ from: c.from || c.user, to, subject, text });
  } finally {
    transporter.close();
  }
}

module.exports = { getSmtpConfig, isSmtpConfigured, sendMail };
