import { useEffect, useRef, useState } from 'react';
import api from '../api';

const countries = ['美国', '英国', '德国', '法国', '意大利', '荷兰', '西班牙', '波兰'];
const currencyByCountry = { 美国: 'USD', 英国: 'GBP', 德国: 'EUR', 法国: 'EUR', 意大利: 'EUR', 荷兰: 'EUR', 西班牙: 'EUR', 波兰: 'PLN' };

export default function PurchaseProducts() {
  const [shops, setShops] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [form, setForm] = useState({
    order_no: '', customer_ref: '', country: '美国', shop_name: '',
    amazon_amount: 0, amazon_tax_amount: 0, shipping_fee: 0,
    shipping_address: { name: '', street: '', city: '', state: '', zip: '', country: 'US', phone: '' },
    items: [{ sku: '', product_name: '', quantity: 1, unit_price: 0 }],
  });
  const [submitting, setSubmitting] = useState(false);
  const [pickedFile, setPickedFile] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/orders/shop-names').then(r => setShops(r.data));
    api.get('/settings').then(r => setExchangeRate(r.data.exchange_rate_cny_per_usd));
  }, []);

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
  const purchaseCny = purchaseUsd * (Number(exchangeRate) || 0);

  const triggerFilePicker = () => fileInputRef.current?.click();
  const onFilePicked = (e) => setPickedFile(e.target.files?.[0] || null);
  const batchPurchase = () => {
    if (!pickedFile) return alert('请先选择亚马逊订单模板文件');
    alert('批量采购功能正在改造中：将通过 SKU 自动匹配 DropXL 商品库并按国家加价后展示采购价。即将上线。');
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
      alert(`采购成功! DropXL订单ID: ${data.dropxl_order_id || '(空)'}`);
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
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">+ 新建采购订单</h1>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn btn-ghost">⬇️ 下载模板</button>
          <button className="btn btn-ghost" onClick={() => history.back()}>← 返回列表</button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded p-3 text-sm">
        ℹ️ 请先选择订单国家，然后填写其他信息，系统将自动计算汇率人民币金额。
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow border border-dashed border-orange-300 p-4">
            <h3 className="font-semibold mb-2">📋 批量采购</h3>
            <div className="text-sm mb-1">上传亚马逊订单模板（.xlsx / .csv）</div>
            <div className="flex gap-2 items-center">
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
              <button type="button" onClick={batchPurchase} className="btn btn-success">批量采购</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold mb-3">📝 基本信息</h3>
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
            <table className="w-full text-sm">
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

        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 sticky top-0">
            <h3 className="font-semibold mb-3">💰 费用信息</h3>
            <div className="space-y-2 text-sm">
              <Row label="币别">{currencyByCountry[form.country] || 'USD'}</Row>
              <Row label="汇率">
                <span title="由店主在系统设置中维护">
                  {exchangeRate == null ? '加载中...' : Number(exchangeRate).toFixed(4)}
                </span>
              </Row>
              <Row label="采购金额(USD)"><b>${purchaseUsd.toFixed(4)}</b></Row>
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
    </div>
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
