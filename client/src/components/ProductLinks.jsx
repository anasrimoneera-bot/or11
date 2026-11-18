import { Link } from 'react-router-dom';

// 订单（所有状态）：按订单国家 + SKU 一键跳转到产品展示的商品详情页（多个 SKU 时每个 SKU 一个链接）
const countryCode = { 美国: 'US', 英国: 'GB', 德国: 'DE', 法国: 'FR', 荷兰: 'NL', 意大利: 'IT', 西班牙: 'ES', 波兰: 'PL' };

export default function ProductLinks({ order, base, className = '' }) {
  const skus = order.skus || [];
  if (!skus.length) return null;
  const cc = countryCode[order.country] || order.country;
  const to = (sku) => `${base}/${encodeURIComponent(cc)}/${encodeURIComponent(sku)}`;
  const cls = `text-indigo-600 hover:underline whitespace-nowrap ${className}`;
  if (skus.length === 1) {
    return <Link to={to(skus[0])} className={cls} title={`查看商品 ${skus[0]} 详情`} onClick={e => e.stopPropagation()}>🛍️ 查看商品</Link>;
  }
  return (
    // 多个 SKU 竖排，保持操作列窄（与其它操作按钮同样右对齐）
    <span className="inline-flex flex-col items-end gap-0.5">
      {skus.map(s => (
        <Link key={s} to={to(s)} className={cls} title={`查看商品 ${s} 详情`} onClick={e => e.stopPropagation()}>🛍️ {s}</Link>
      ))}
    </span>
  );
}
