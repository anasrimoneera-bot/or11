import { useEffect, useRef, useState } from 'react';
import api from '../api';

const countries = ['美国', '英国', '德国', '法国', '意大利', '荷兰', '西班牙', '波兰'];
const currencyByCountry = { 美国: 'USD', 英国: 'GBP', 德国: 'EUR', 法国: 'EUR', 意大利: 'EUR', 荷兰: 'EUR', 西班牙: 'EUR', 波兰: 'PLN' };
const currencySymbol = { USD: '$', EUR: '€', GBP: '£', PLN: 'zł' };

export default function PurchaseProducts() {
  const [shops, setShops] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(null); // 已废弃 fallback，留作懒加载兜底
  const [purchaseRates, setPurchaseRates] = useState({}); // { USD: 6.86, EUR: 7.8, ... }
  const [form, setForm] = useState({
    order_no: '', customer_ref: '', country: '美国', shop_name: '',
    amazon_amount: 0, amazon_tax_amount: 0, shipping_fee: 0,
    shipping_address: { name: '', street: '', city: '', state: '', zip: '', country: 'US', phone: '' },
    items: [{ sku: '', product_name: '', quantity: 1, unit_price: 0 }],
  });
  const [submitting, setSubmitting] = useState(false);
  const [pickedFile, setPickedFile] = useState(null);
  const [preview, setPreview] = useState(null);   // { rows, groups, summary, exchange_rate }
  const [previewing, setPreviewing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/orders/shop-names').then(r => setShops(r.data));
    api.get('/settings').then(r => {
      setExchangeRate(r.data.exchange_rate_cny_per_usd);
      // 采购汇率按国家给（= 该国亚马逊汇率 × 1.012）
      setPurchaseRates(r.data.purchase_rate_by_country || {});
    });
  }, []);

  // 当前国家的币种 + 采购汇率（亚马逊汇率 ×1.012）
  const currentCurrency = currencyByCountry[form.country] || 'USD';
  const currentRate = purchaseRates[form.country] ?? 0;

  const downloadTemplate = async () => {
    try {
      const r = await api.get('/orders/template', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'amazon-order-template.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert('下载失败：' + (e.response?.data?.error || e.message)); }
  };

  const purchaseUsd = form.items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1), 0);
  const purchaseCny = purchaseUsd * (Number(currentRate) || 0);

  const triggerFilePicker = () => {
    // 选同一个文件时 input.value 没变 onChange 不会触发，先清空保证每次都重新解析
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  };
  // 选完文件立刻自动解析 + 匹配
  const onFilePicked = async (e) => {
    const f = e.target.files?.[0] || null;
    setPickedFile(f);
    setPreview(null);
    if (!f) return;
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api.post('/orders/batch/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(r.data);
    } catch (err) {
      alert(err.response?.data?.error || '解析失败：' + err.message);
    } finally {
      setPreviewing(false);
    }
  };
  // 批量采购按钮 -> 打开确认模态
  const batchPurchase = () => {
    if (!preview) return alert('请先选择文件等待解析完成');
    setShowConfirmModal(true);
  };
  const submitBatch = async (excluded) => {
    if (!preview) return;
    const excludedSet = excluded instanceof Set ? excluded : new Set();
    const submittable = preview.rows.filter(r =>
      r.matched && r.errors.length === 0 && !excludedSet.has(r.amazon_order_id)
    );
    if (submittable.length === 0) return alert('没有可提交的行');
    setBatchSubmitting(true);
    try {
      const r = await api.post('/orders/batch/submit', { rows: submittable });
      const s = r.data.summary;
      const pushMsg = s.dropxl_pushed != null
        ? `\n\n供应商系统推送：成功 ${s.dropxl_pushed} / 失败 ${s.dropxl_push_failed}` +
          (s.dropxl_push_failed > 0 ? '\n失败订单可在订单管理页查看错误并由管理员重试' : '\n订单已成功推送至供应商，等待店主完成支付')
        : '';
      alert(`本地入库：成功 ${s.created} / 跳过(已存在) ${s.skipped} / 失败 ${s.failed}${pushMsg}`);
      setShowConfirmModal(false);
      setPreview(null);
      setPickedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      alert(e.response?.data?.error || '提交失败');
    } finally {
      setBatchSubmitting(false);
    }
  };

  // 在订单组详情里订正买家地址：同步更新该组 shipping 和底层提交用的 rows（按 amazon_order_id 匹配）
  const updateGroupShipping = (amazonOrderId, shipping) => {
    setPreview(prev => {
      if (!prev) return prev;
      const groups = prev.groups.map(g => g.amazon_order_id === amazonOrderId ? { ...g, shipping: { ...g.shipping, ...shipping } } : g);
      const rows = prev.rows.map(r => r.amazon_order_id === amazonOrderId ? {
        ...r,
        recipient_name: shipping.name,
        ship_phone: shipping.phone,
        buyer_email: shipping.email,
        ship_address1: shipping.address1,
        ship_address2: shipping.address2,
        ship_city: shipping.city,
        ship_state: shipping.state,
        ship_postal: shipping.postal,
      } : r);
      return { ...prev, groups, rows };
    });
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { sku: '', product_name: '', quantity: 1, unit_price: 0 }] });
  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  const updateItem = (i, k, v) => {
    const items = [...form.items]; items[i][k] = v;
    setForm({ ...form, items });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data } = await api.post('/orders', form);
      alert(`采购成功! 供应商订单 ID: ${data.dropxl_order_id || '(空)'}`);
      setForm({ ...form, order_no: '', items: [{ sku: '', product_name: '', quantity: 1, unit_price: 0 }] });
    } catch (e) {
      alert('采购失败: ' + (e.response?.data?.error || e.message));
    } finally {
      setSubmitting(false);
    }
  };

  const useAmazonNo = () => {
    setForm({ ...form, customer_ref: form.order_no });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <h1 className="text-2xl font-bold">+ 新建采购订单</h1>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn btn-ghost">⬇️ 下载模板</button>
          <button className="btn btn-ghost" onClick={() => history.back()}>← 返回列表</button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded p-3 text-sm">
        ℹ️ 请先选择订单国家，然后填写其他信息，系统将自动计算汇率人民币金额。
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow border border-dashed border-orange-300 p-4">
            <h3 className="font-semibold mb-2">📋 批量采购</h3>
            <div className="text-sm mb-1">上传采购订单CSV文件</div>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onFilePicked}
              />
              <div className="flex-1 field flex items-center text-sm text-gray-600 truncate">
                {pickedFile ? pickedFile.name : '未选择任何文件'}
              </div>
              <button type="button" onClick={triggerFilePicker} className="btn btn-warning">选择文件</button>
              <button
                type="button"
                onClick={batchPurchase}
                disabled={!preview || previewing || (preview && preview.summary.ready_to_submit_groups === 0)}
                className="btn btn-success"
              >
                批量采购
              </button>
            </div>
            {previewing && (
              <div className="text-sm text-blue-600 mt-3 bg-blue-50 border border-blue-200 rounded p-2">
                ⏳ 正在解析并匹配商品库存价格...
              </div>
            )}
            {!previewing && preview && (
              <div className="text-sm text-blue-700 mt-3 bg-blue-50 border border-blue-200 rounded p-2">
                已解析 <b>{preview.summary.total_items}</b> 个商品，
                分为 <b>{preview.summary.total_groups}</b> 个订单组，
                {preview.summary.ready_to_submit_groups < preview.summary.total_groups && (
                  <span className="text-red-600">
                    其中 {preview.summary.total_groups - preview.summary.ready_to_submit_groups} 组未完全匹配，
                  </span>
                )}
                准备确认
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold mb-3">📝 基本信息</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="col-span-2 flex justify-between items-center">
                <label className="text-sm">订单号 *</label>
                <button onClick={useAmazonNo} className="text-xs text-blue-600">使用亚马逊订单号</button>
              </div>
              <input className="col-span-2 field" placeholder="请输入亚马逊订单号" value={form.order_no} onChange={e => setForm({ ...form, order_no: e.target.value })} />

              <div>
                <label className="text-sm">订单国家 *</label>
                <select className="field" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}>
                  {countries.map(c => <option key={c}>{c}</option>)}
                </select>
                <div className="text-xs text-blue-600 mt-1">已切换到{form.country}的API配置</div>
              </div>
              <div>
                <label className="text-sm">店铺名 *</label>
                <input
                  className="field"
                  list="shop-name-options"
                  value={form.shop_name}
                  onChange={e => setForm({ ...form, shop_name: e.target.value })}
                  placeholder="填写或选择店铺名 (来自亚马逊订单模板的 shop-name 列)"
                />
                <datalist id="shop-name-options">
                  {shops.map(name => <option key={name} value={name} />)}
                </datalist>
              </div>
              <div>
                <label className="text-sm">亚马逊订单金额</label>
                <input type="number" step="0.01" className="field" value={form.amazon_amount} onChange={e => setForm({ ...form, amazon_amount: e.target.value })} />
              </div>
              <div>
                <label className="text-sm">亚马逊税后金额</label>
                <input type="number" step="0.01" className="field" value={form.amazon_tax_amount} onChange={e => setForm({ ...form, amazon_tax_amount: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-sm">运费</label>
                <input type="number" step="0.01" className="field" value={form.shipping_fee} onChange={e => setForm({ ...form, shipping_fee: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold mb-3">📍 收货地址</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="field" placeholder="收件人姓名" value={form.shipping_address.name} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, name: e.target.value } })} />
              <input className="field" placeholder="电话" value={form.shipping_address.phone} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, phone: e.target.value } })} />
              <input className="col-span-2 field" placeholder="街道地址" value={form.shipping_address.street} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, street: e.target.value } })} />
              <input className="field" placeholder="城市" value={form.shipping_address.city} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, city: e.target.value } })} />
              <input className="field" placeholder="州/省" value={form.shipping_address.state} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, state: e.target.value } })} />
              <input className="field" placeholder="邮编" value={form.shipping_address.zip} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, zip: e.target.value } })} />
              <input className="field" placeholder="国家代码 (US)" value={form.shipping_address.country} onChange={e => setForm({ ...form, shipping_address: { ...form.shipping_address, country: e.target.value } })} />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">🛍️ 商品列表</h3>
              <button onClick={addItem} className="btn btn-ghost text-sm">+ 添加商品</button>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left">SKU</th>
                  <th className="px-2 py-2 text-left">商品名</th>
                  <th className="px-2 py-2 w-20">数量</th>
                  <th className="px-2 py-2 w-28">单价(USD)</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1"><input className="field" value={it.sku} onChange={e => updateItem(i, 'sku', e.target.value)} /></td>
                    <td className="px-2 py-1"><input className="field" value={it.product_name} onChange={e => updateItem(i, 'product_name', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" className="field" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" step="0.01" className="field" value={it.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} /></td>
                    <td className="text-center"><button onClick={() => removeItem(i)} className="text-red-500">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 lg:sticky lg:top-0">
            <h3 className="font-semibold mb-3">💰 费用信息</h3>
            <div className="space-y-2 text-sm">
              <Row label="币别"><b>{currentCurrency}</b> <span className="text-xs text-gray-500 ml-1">({currencySymbol[currentCurrency]})</span></Row>
              <Row label="汇率">
                <span title={`由店主在系统设置 → 采购各币种汇率 中维护 (${currentCurrency})`}>
                  {currentRate > 0 ? `1 ${currentCurrency} = ${Number(currentRate).toFixed(4)} CNY` : <span className="text-red-500">未配置 {currentCurrency} 汇率</span>}
                </span>
              </Row>
              <Row label={`采购金额(${currentCurrency})`}><b>{currencySymbol[currentCurrency]}{purchaseUsd.toFixed(2)}</b></Row>
              <div className="border-t pt-2 mt-2 flex justify-between items-center">
                <span>需要支付人民币：</span>
                <b className="text-xl text-red-600">¥{purchaseCny.toFixed(2)}</b>
              </div>
            </div>
            <button disabled={submitting} onClick={submit} className="btn btn-success w-full justify-center mt-4">
              {submitting ? '提交中...' : '✓ 提交采购订单'}
            </button>
          </div>
        </div>
      </div>

      {showConfirmModal && preview && (
        <BatchConfirmModal
          preview={preview}
          onClose={() => setShowConfirmModal(false)}
          onSubmit={submitBatch}
          onEditShipping={updateGroupShipping}
          submitting={batchSubmitting}
        />
      )}
    </div>
  );
}

function AddrField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input className="field w-full" value={value || ''} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-600">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function BatchConfirmModal({ preview, onClose, onSubmit, onEditShipping, submitting }) {
  const { groups = [], summary, exchange_rate } = preview;
  // 被用户手动删除的订单组 amazon_order_id 集合（不传给后端）
  const [excluded, setExcluded] = useState(() => new Set());
  const toggleExclude = (id) => {
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const visibleGroups = groups.filter(g => !excluded.has(g.amazon_order_id));
  const submittableGroups = visibleGroups.filter(g => g.all_matched);
  const liveTotalUsd = submittableGroups.reduce((s, g) => s + (g.total_usd || 0), 0);
  const liveTotalCny = submittableGroups.reduce((s, g) => s + (g.total_cny || 0), 0);

  const handleSubmit = () => onSubmit(excluded);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl my-4 flex flex-col" style={{ maxHeight: 'calc(100vh - 32px)' }}>
        <div className="flex justify-between items-center p-4 border-b">
          <div className="font-bold text-lg">批量采购确认</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
            <div className="text-xs text-blue-600">商品总数</div>
            <div className="text-2xl font-bold mt-1">{summary.total_items}</div>
          </div>
          <div className="rounded-lg bg-green-50 border border-green-100 p-3">
            <div className="text-xs text-green-700">订单组数 {excluded.size > 0 && <span className="text-xs text-gray-500">(已剔除 {excluded.size})</span>}</div>
            <div className="text-2xl font-bold mt-1">{visibleGroups.length}</div>
          </div>
          <div className="rounded-lg bg-yellow-50 border border-yellow-100 p-3">
            <div className="text-xs text-yellow-700">当前汇率</div>
            <div className="text-2xl font-bold mt-1">1: {exchange_rate} CNY</div>
          </div>
        </div>

        <div className="px-5 pt-4 font-semibold">订单组详情</div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {visibleGroups.map(g => (
            <OrderGroupCard
              key={g.amazon_order_id}
              group={g}
              exchangeRate={exchange_rate}
              onEditShipping={onEditShipping}
              onRemove={() => {
                if (confirm(`从本次批量中移除订单 ${g.amazon_order_id}？（不影响文件本身）`)) toggleExclude(g.amazon_order_id);
              }}
            />
          ))}
          {visibleGroups.length === 0 && <div className="text-center text-gray-400 py-12">所有订单都被移除了</div>}
        </div>

        <div className="border-t p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50">
          <div className="text-sm text-gray-600">
            <div>所有订单总金额：<b className="text-xl text-gray-900 ml-1">{liveTotalUsd.toFixed(2)}</b></div>
          </div>
          <div className="text-sm text-gray-600">
            <div>所需人民币：<b className="text-xl text-red-600 ml-1">{liveTotalCny.toFixed(2)} CNY</b></div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || submittableGroups.length === 0}
            className="btn btn-success"
          >
            {submitting ? '提交中...' : `✓ 确认提交 ${submittableGroups.length} 组`}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderGroupCard({ group, exchangeRate, onRemove, onEditShipping }) {
  const allOk = group.all_matched && group.errors.length === 0;
  const [editAddr, setEditAddr] = useState(false);
  const [addr, setAddr] = useState(group.shipping);
  const setA = (k, v) => setAddr(p => ({ ...p, [k]: v }));
  const saveAddr = () => { onEditShipping?.(group.amazon_order_id, addr); setEditAddr(false); };
  const cancelAddr = () => { setAddr(group.shipping); setEditAddr(false); };
  return (
    <div className={`rounded-lg border ${allOk ? 'border-gray-200' : 'border-red-300 bg-red-50'} p-4 text-sm`}>
      <div className="flex justify-between items-start mb-2">
        <div className="font-semibold">订单组: <span className="font-mono">{group.order_id}</span></div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500">商品数量: {group.items.length}</div>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-xs text-red-600 border border-red-200 hover:bg-red-50 rounded px-2 py-0.5"
              title="从本次批量中移除该订单"
            >
              🗑️ 移除
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-gray-700 mb-3">
        <div>国家: <b>{group.country_code || '-'}</b></div>
        <div>订单号: <span className="font-mono">{group.amazon_order_id}</span></div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">订单详情：</div>
        {onEditShipping && !editAddr && (
          <button type="button" onClick={() => { setAddr(group.shipping); setEditAddr(true); }} className="text-xs text-blue-600 hover:underline">✏️ 编辑买家地址</button>
        )}
      </div>
      {!editAddr ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-gray-700 mb-3">
          <div>店铺名称: <b>{group.shop_name || '-'}</b></div>
          <div>客户名称: <b>{group.shipping.name || '-'}</b></div>
          <div>客户电话: {group.shipping.phone || '-'}</div>
          <div>客户邮箱: {group.shipping.email || '-'}</div>
          <div>地址1: {group.shipping.address1 || '-'}<br/>地址2: {group.shipping.address2 || ''}</div>
          <div>城市: {group.shipping.city || '-'}</div>
          <div>州/省: {group.shipping.state || '-'}</div>
          <div>邮编: {group.shipping.postal || '-'}</div>
        </div>
      ) : (
        <div className="border rounded p-3 mb-3 bg-blue-50/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AddrField label="收件人" value={addr.name} onChange={v => setA('name', v)} />
            <AddrField label="电话" value={addr.phone} onChange={v => setA('phone', v)} />
            <AddrField label="邮箱" value={addr.email} onChange={v => setA('email', v)} />
            <AddrField label="城市" value={addr.city} onChange={v => setA('city', v)} />
            <AddrField label="地址1" value={addr.address1} onChange={v => setA('address1', v)} />
            <AddrField label="地址2" value={addr.address2} onChange={v => setA('address2', v)} />
            <AddrField label="州/省" value={addr.state} onChange={v => setA('state', v)} />
            <AddrField label="邮编" value={addr.postal} onChange={v => setA('postal', v)} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={cancelAddr} className="text-xs px-3 py-1 rounded border">取消</button>
            <button type="button" onClick={saveAddr} className="text-xs px-3 py-1 rounded bg-blue-600 text-white">✓ 应用到本订单</button>
          </div>
          <div className="text-xs text-gray-500 mt-1">修改后将用新地址提交并推送到供应商。</div>
        </div>
      )}
      <div className="font-medium mb-2">商品列表：</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left">产品图片</th>
              <th className="px-2 py-1.5 text-left">SKU</th>
              <th className="px-2 py-1.5 text-left">产品名称</th>
              <th className="px-2 py-1.5 text-right">数量</th>
              <th className="px-2 py-1.5 text-right">采购单价</th>
              <th className="px-2 py-1.5 text-right">小计</th>
              <th className="px-2 py-1.5 text-right">小计(CNY)</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map(it => (
              <tr key={it.row_no} className="border-t align-top">
                <td className="px-2 py-1.5">
                  {it.image_url
                    ? <img src={it.image_url} alt="" className="w-14 h-14 object-cover rounded bg-gray-100 border" loading="lazy" onError={e => { e.currentTarget.style.display='none'; }} />
                    : <div className="w-14 h-14 bg-gray-100 rounded border flex items-center justify-center text-gray-300 text-xl">📦</div>}
                </td>
                <td className="px-2 py-1 font-mono">{it.sku}</td>
                <td className="px-2 py-1 max-w-xs truncate" title={it.product_name}>{it.product_name || '—'}</td>
                <td className="px-2 py-1 text-right">{it.quantity}</td>
                <td className="px-2 py-1 text-right">{it.unit_price_usd != null ? Number(it.unit_price_usd).toFixed(2) : '—'}</td>
                <td className="px-2 py-1 text-right">{Number(it.subtotal_usd || 0).toFixed(2)}</td>
                <td className="px-2 py-1 text-right text-red-600">{Number(it.subtotal_cny || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-gray-50">
              <td colSpan="5" className="px-2 py-2 text-right text-gray-600">订单组总金额:</td>
              <td className="px-2 py-2 text-right font-bold">{group.total_usd.toFixed(2)}</td>
              <td className="px-2 py-2 text-right font-bold text-red-600">{group.total_cny.toFixed(2)} CNY</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!allOk && (
        <div className="mt-2 text-xs text-red-600 bg-red-100 rounded p-2">
          ⚠ {group.errors.join('；') || '订单组中有未匹配的商品，提交时会跳过'}
        </div>
      )}
    </div>
  );
}
