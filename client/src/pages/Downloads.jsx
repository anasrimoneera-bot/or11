import { useEffect, useState } from 'react';
import api from '../api';

const countries = [
  { name: '美国', code: 'US' }, { name: '英国', code: 'GB' }, { name: '德国', code: 'DE' },
  { name: '法国', code: 'FR' }, { name: '荷兰', code: 'NL' }, { name: '意大利', code: 'IT' },
  { name: '西班牙', code: 'ES' }, { name: '波兰', code: 'PL' },
];

export default function Downloads() {
  const [status, setStatus] = useState({});
  const [masterStatus, setMasterStatus] = useState({});
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api.get('/inventory/status').then(r => {
      const map = {};
      for (const s of r.data) map[s.country] = s;
      setStatus(map);
    }).catch(() => {});
    api.get('/inventory/master-status').then(r => {
      const map = {};
      for (const s of r.data) map[s.country] = s;
      setMasterStatus(map);
    }).catch(() => {});
  }, []);

  const downloadMaster = async (country) => {
    setBusy('master-' + country);
    try {
      const r = await api.get(`/inventory/master/${encodeURIComponent(country)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      const cd = r.headers['content-disposition'] || '';
      const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i);
      a.href = url;
      a.download = match ? decodeURIComponent(match[1]) : `${country}-master.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      let msg = '下载失败';
      if (e.response?.data instanceof Blob) {
        try { msg = JSON.parse(await e.response.data.text()).error || msg; } catch {}
      } else { msg = e.response?.data?.error || e.message; }
      alert(msg);
    } finally { setBusy(null); }
  };

  const downloadFeed = async (country) => {
    setBusy(country);
    try {
      const r = await api.get(`/inventory/${encodeURIComponent(country)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      // 后端 Content-Disposition 会带原始文件名；前端做兜底
      const cd = r.headers['content-disposition'] || '';
      const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i);
      a.href = url;
      a.download = match ? decodeURIComponent(match[1]) : `${country}-inventory.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      let msg = '下载失败';
      if (e.response?.data instanceof Blob) {
        try { msg = JSON.parse(await e.response.data.text()).error || msg; } catch {}
      } else {
        msg = e.response?.data?.error || e.message;
      }
      alert(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">下载支持</h1>
        <p className="text-gray-500 text-sm">下载库存更新数据和工具文件</p>
      </div>

      <div className="bg-white rounded-xl shadow border-l-4 border-blue-500 p-5">
        <h2 className="font-semibold mb-3 text-blue-600">🌐 库存更新下载</h2>
        <p className="text-sm text-gray-600 mb-4">下载各国库存更新数据 (XLSX 格式)。由店主端最新上传的源文件原样下发。</p>
        <div className="grid grid-cols-4 gap-3">
          {countries.map(c => {
            const s = status[c.name];
            const disabled = !s?.available || busy === c.name;
            return (
              <button
                key={c.code}
                onClick={() => downloadFeed(c.name)}
                disabled={disabled}
                className={`rounded-lg py-3 px-4 flex flex-col items-start gap-1 transition ${
                  disabled
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                <span className="w-full flex justify-between items-center font-medium">
                  🌐 {c.name} 库存更新 <span>{busy === c.name ? '...' : '⬇️'}</span>
                </span>
                <span className="text-xs opacity-80">
                  {s?.available
                    ? `${s.rows_count} 条 · ${new Date(s.uploaded_at).toLocaleDateString()}`
                    : '暂未上传'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border-l-4 border-emerald-500 p-5">
        <h2 className="font-semibold mb-3 text-emerald-700">📑 各国销售总表下载</h2>
        <p className="text-sm text-gray-600 mb-4">含 SKU 白名单 + 主图链接的精选目录（由店主端上传维护）。</p>
        <div className="grid grid-cols-4 gap-3">
          {countries.map(c => {
            const ms = masterStatus[c.name];
            const disabled = !ms?.available || busy === ('master-' + c.name);
            return (
              <button
                key={c.code}
                onClick={() => downloadMaster(c.name)}
                disabled={disabled}
                className={`rounded-lg py-3 px-4 flex flex-col items-start gap-1 transition ${
                  disabled
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600'
                }`}
              >
                <span className="w-full flex justify-between items-center font-medium">
                  📑 {c.name} 总表 <span>{busy === ('master-' + c.name) ? '...' : '⬇️'}</span>
                </span>
                <span className="text-xs opacity-80">
                  {ms?.available
                    ? `${ms.rows_count} 条 SKU · ${new Date(ms.uploaded_at).toLocaleDateString()}`
                    : '暂未上传'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border-l-4 border-green-500 p-5">
        <h2 className="font-semibold mb-3 text-green-600">📄 工具文件下载</h2>
        <p className="text-sm text-gray-600 mb-4">下载蓝鲸工具客户端安装程序</p>
        <div className="grid grid-cols-4 gap-3">
          <button onClick={() => alert('蓝鲸工具安装EXE下载')} className="bg-green-500 text-white rounded-lg py-3 px-4 flex justify-between items-center hover:bg-green-600">
            📄 蓝鲸工具安装EXE下载 <span>⬇️</span>
          </button>
        </div>
      </div>
    </div>
  );
}
