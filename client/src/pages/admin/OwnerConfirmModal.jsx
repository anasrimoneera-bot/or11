import { useState } from 'react';
import api from '../../api';

// 店主版确认弹窗：可调整真实采购价、加价百分比，可看利润
// 通过 React.lazy 加载，员工浏览器不会下载此模块。
export default function OwnerConfirmModal({ order, onClose, onDone }) {
  const [realUsd, setRealUsd] = useState(order.real_amount_usd || '');
  const [markup, setMarkup] = useState(order.markup_pct ?? 30);
  const [rate, setRate] = useState(order.exchange_rate || 7.2);
  const [refund, setRefund] = useState(0);
  const [note, setNote] = useState('');

  const realCny = (Number(realUsd) || 0) * (Number(rate) || 0);
  const displayUsd = (Number(realUsd) || 0) * (1 + (Number(markup) || 0) / 100);
  const displayCny = displayUsd * (Number(rate) || 0);
  const deduct = displayCny - (Number(refund) || 0);
  const profit = deduct - realCny;

  const submit = async () => {
    try {
      await api.post(`/admin/orders/${order.id}/confirm`, {
        real_amount_usd: Number(realUsd),
        markup_pct: Number(markup),
        exchange_rate: Number(rate),
        distributor_refund: Number(refund),
        note,
      });
      onDone();
    } catch (e) { alert(e.response?.data?.error || '操作失败'); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-[560px]">
        <div className="font-semibold text-lg mb-4">确认采购订单</div>
        <div className="bg-gray-50 rounded p-3 mb-4 text-sm space-y-1">
          <div>订单号：<span className="font-mono">{order.order_no}</span></div>
          <div>用户：{order.display_name || order.username}</div>
          <div>国家/店铺：{order.country} / {order.shop_name}</div>
          <div>亚马逊订单金额：${(order.amazon_amount || 0).toFixed(2)}</div>
          <div>供应商订单 ID：<span className="font-mono">{order.dropxl_order_id || '(未创建)'}</span></div>
          {order.real_amount_usd > 0 && <div className="text-blue-600">供应商返回真实价：${order.real_amount_usd.toFixed(2)} (可调整)</div>}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div>
            <label className="text-sm">真实采购价 (USD) *</label>
            <input className="field" type="number" step="0.01" value={realUsd} onChange={e => setRealUsd(e.target.value)} placeholder="供应商实际价" />
          </div>
          <div>
            <label className="text-sm">加价 % *</label>
            <input className="field" type="number" step="0.1" value={markup} onChange={e => setMarkup(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">汇率 *</label>
            <input className="field" type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} />
          </div>
        </div>
        <label className="text-sm">分销补款 (¥) - 可选</label>
        <input className="field mb-2" type="number" step="0.01" value={refund} onChange={e => setRefund(e.target.value)} placeholder="给用户额外的折扣/补贴" />
        <label className="text-sm">备注</label>
        <input className="field mb-3" value={note} onChange={e => setNote(e.target.value)} />

        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm space-y-1">
          <div className="flex justify-between"><span>真实价 (USD → ¥)：</span><span>${(Number(realUsd) || 0).toFixed(2)} → ¥{realCny.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>加价 {markup}% 后向用户显示：</span><b>${displayUsd.toFixed(2)} / ¥{displayCny.toFixed(2)}</b></div>
          <div className="flex justify-between"><span>分销补款 (¥)：</span><span>-¥{(Number(refund) || 0).toFixed(2)}</span></div>
          <div className="flex justify-between border-t pt-1 mt-1"><span>从用户余额扣除：</span><b className="text-red-600">¥{deduct.toFixed(2)}</b></div>
          <div className="flex justify-between"><span>预计利润 (¥)：</span><b className="text-green-600">+¥{profit.toFixed(2)}</b></div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-success" onClick={submit}>✓ 确认扣款</button>
        </div>
      </div>
    </div>
  );
}
