// 订单取消 / 删除时把该订单在余额里的「净扣款」退回给下单用户。
// 净扣款 = balance_records 里 related_order 为该订单号的所有记录之和（采购扣款为负、售后退款等为正），
// 所以已部分退过的只退剩余部分；重复调用不会重复退款。
const db = require('./db');

const Q_NET = db.prepare('SELECT IFNULL(SUM(amount), 0) AS s FROM balance_records WHERE related_order = ?');
const Q_BAL = db.prepare('SELECT balance FROM user_balance WHERE user_id = ?');
const INS_BAL = db.prepare('INSERT OR IGNORE INTO user_balance (user_id, balance) VALUES (?, 0)');
const UPD_BAL = db.prepare('UPDATE user_balance SET balance = ? WHERE user_id = ?');
const INS_REC = db.prepare(`
  INSERT INTO balance_records (user_id, type, amount, balance_after, description, related_order)
  VALUES (?, '退款', ?, ?, ?, ?)
`);

// order 需含 user_id、order_no；返回退回的金额（无需退款时为 0）
const refundOrderBalance = db.transaction((order, reason) => {
  const net = Q_NET.get(order.order_no).s;
  const refund = net < 0 ? Math.round(-net * 100) / 100 : 0;
  if (refund <= 0) return 0;
  const bal = Q_BAL.get(order.user_id);
  if (!bal) INS_BAL.run(order.user_id);
  const newBal = (bal?.balance || 0) + refund;
  UPD_BAL.run(newBal, order.user_id);
  INS_REC.run(order.user_id, refund, newBal, `${reason} - ${order.order_no}`, order.order_no);
  return refund;
});

module.exports = { refundOrderBalance };
