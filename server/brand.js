// 商品数据去供应商品牌：名称 / 分类里出现的供应商字样（vidaXL、DropXL 等）一律替换为 B2BSXLJ。
// 同步写库时替换一次，接口返回时再兜底替换一次。
const SUPPLIER_RE = /\b(?:vida\s*xl|drop\s*xl)\b/gi;

function brandText(s) {
  return s == null ? s : String(s).replace(SUPPLIER_RE, 'B2BSXLJ');
}

module.exports = { brandText };
