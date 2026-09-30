// 成本相关列 - 通过 lazy load 隔离，主 bundle (含分销商) 不会下载此 chunk。
// 店主 + 管理员可见；分销商根本进不了 /admin 路由，自然看不到。
import api from '../../api';
import EditableAmount from '../../components/EditableAmount.jsx';

// 订单管理：店主+管理员可见的成本列
// 真实(原币)(BOSS可编辑) | 加价% | PayPal汇率(可编辑) | 真实采购价(¥) | 差价利润(¥)
// 真实成本与"采购(原币)"同币种，即订单所属国家的站点币种（德国=EUR、英国=GBP…），
// 不是美元。表头对整表生效、每行国家可能不同，故写"原币"，具体符号在单元格按行显示。
export function OrderRealHeader() {
  return (
    <>
      <th className="px-3 py-2 text-right text-red-600" title="供应商真实成本，币种同该订单的站点币种">真实(原币)</th>
      <th className="px-3 py-2 text-right text-red-600">加价%</th>
      <th className="px-3 py-2 text-right text-red-600" title="向 DropXL 用 PayPal 付款时 PayPal 显示的汇率，1 CNY = ? 原币，每次付款都不同">PayPal汇率</th>
      <th className="px-3 py-2 text-right text-red-600" title="真实(原币) ÷ PayPal 汇率">真实采购价(¥)</th>
      <th className="px-3 py-2 text-right text-red-600" title="用户采购价(¥) − 真实采购价(¥)，店主+合伙人的差价利润">差价利润(¥)</th>
    </>
  );
}

// sym: 该订单站点币种符号（由 AdminOrders 按 country 传入，默认 $ 仅为兜底）
export function OrderRealCells({ order, onChanged, isOwner, sym = '$' }) {
  const realUsd = Number(order?.real_amount_usd) || 0;
  const markupPct = order?.markup_pct ?? 0;
  const paypalRate = Number(order?.paypal_rate) || 0;
  const purchaseCny = Number(order?.purchase_amount_cny) || 0;
  const realCny = paypalRate > 0 ? realUsd / paypalRate : null;
  const profitDiff = realCny != null ? purchaseCny - realCny : null;
  return (
    <>
      <td className="px-3 py-2 text-right text-red-600">
        {/* 真实(原币) 仅 BOSS 可编辑；只订正真实成本，不改用户采购价 */}
        {isOwner ? (
          <EditableAmount
            value={realUsd}
            prefix={sym}
            onSave={async (v) => {
              await api.put(`/admin/orders/${order.id}/real-price`, { real_amount_usd: v });
              onChanged && onChanged();
            }}
          />
        ) : (
          `${sym}${realUsd.toFixed(2)}`
        )}
      </td>
      <td className="px-3 py-2 text-right text-red-600">
        {/* 加价% 仅 BOSS 可编辑，任意订单状态均可改；改后按 真实×(1+加价%) 重算用户采购价 */}
        {isOwner ? (
          <EditableAmount
            value={markupPct}
            prefix=""
            suffix="%"
            decimals={2}
            onSave={async (v) => {
              await api.put(`/admin/orders/${order.id}/markup`, { markup_pct: v });
              onChanged && onChanged();
            }}
          />
        ) : (
          `${markupPct}%`
        )}
      </td>
      <td className="px-3 py-2 text-right text-red-600">
        {/* PayPal 汇率仅 BOSS 可编辑；其他管理员只读 */}
        {isOwner ? (
          <EditableAmount
            value={paypalRate}
            prefix=""
            decimals={5}
            onSave={async (v) => {
              await api.put(`/admin/orders/${order.id}/paypal-rate`, { paypal_rate: v });
              onChanged && onChanged();
            }}
          />
        ) : (
          paypalRate > 0 ? paypalRate.toFixed(5) : <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-red-600">
        {realCny != null ? `¥${realCny.toFixed(2)}` : <span className="text-gray-400">—</span>}
      </td>
      <td className={`px-3 py-2 text-right font-semibold ${profitDiff == null ? 'text-gray-400' : profitDiff >= 0 ? 'text-green-700' : 'text-red-600'}`}
          title={profitDiff == null ? '请先填 PayPal 汇率' : ''}>
        {profitDiff == null ? '—' : `${profitDiff >= 0 ? '+' : ''}¥${profitDiff.toFixed(2)}`}
      </td>
    </>
  );
}

export default {};
