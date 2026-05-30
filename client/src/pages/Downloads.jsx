import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { bgUpload, emitUploadFinished, onUploadFinished } from '../lib/bgUpload.js';

const countries = [
  { name: '美国', code: 'US' }, { name: '英国', code: 'GB' }, { name: '德国', code: 'DE' },
  { name: '法国', code: 'FR' }, { name: '荷兰', code: 'NL' }, { name: '意大利', code: 'IT' },
  { name: '西班牙', code: 'ES' }, { name: '波兰', code: 'PL' },
];

export default function Downloads() {
  const [status, setStatus] = useState({});
  const [masterStatus, setMasterStatus] = useState({});
  const [busy, setBusy] = useState(null);
  const [me, setMe] = useState(null);
  const [installer, setInstaller] = useState(null);
  const [, forceTick] = useState(0); // 订阅 bgUpload 状态变化，让"上传中"指示在切页回来后仍可见
  const installerInputRef = useRef(null);
  // 后台上传：切换页面/导航不会中断上传，刷新浏览器才会（XHR 被浏览器取消）
  const uploadingInstaller = bgUpload.isActive('installer-upload');
  const isOwner = !!me?.is_owner;

  const loadInstaller = () => api.get('/tools/installer/status').then(r => setInstaller(r.data)).catch(() => {});

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
    api.get('/auth/me').then(r => setMe(r.data)).catch(() => {});
    loadInstaller();
  }, []);

  // 跨页订阅 bgUpload：切到别的页面再回来时，仍能看到「上传中...」状态
  useEffect(() => bgUpload.subscribe(() => forceTick(n => n + 1)), []);
  // 监听上传完成事件：刷新状态、给出成功/失败提示
  useEffect(() => onUploadFinished(({ key, ok, error }) => {
    if (key !== 'installer-upload') return;
    loadInstaller();
    if (ok) alert('安装包上传成功');
    else alert('安装包上传失败：' + (error || '未知错误'));
  }), []);

  const onPickInstaller = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.exe$/i.test(f.name) && !confirm(`选中的文件 ${f.name} 不是 .exe，仍然上传吗？`)) {
      e.target.value = '';
      return;
    }
    const sizeMB = (f.size / 1024 / 1024).toFixed(1);
    const fd = new FormData();
    fd.append('file', f);
    // fire-and-forget：上传交给 bgUpload 跟踪，组件切换/卸载不影响请求；
    // 完成后通过 emitUploadFinished 通知当前挂载的 Downloads 页刷新状态。
    const promise = api.post('/tools/installer/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
    })
      .then(() => emitUploadFinished({ key: 'installer-upload', ok: true }))
      .catch(err => emitUploadFinished({
        key: 'installer-upload', ok: false,
        error: err.response?.data?.error || err.message,
      }));
    bgUpload.start('installer-upload', promise, `蓝鲸工具安装包 (${sizeMB}MB)`);
    if (installerInputRef.current) installerInputRef.current.value = '';
  };

  // 110MB 安装包走浏览器原生下载（先取短期票据，再用 <a> 触发）。
  // 旧实现把整个二进制塞进 axios Blob，导致点完按钮长时间无任何反馈、也无法分段/续传。
  const downloadInstaller = async () => {
    setBusy('installer');
    try {
      const { data } = await api.post('/tools/installer/ticket');
      const a = document.createElement('a');
      a.href = `/api/tools/installer?ticket=${encodeURIComponent(data.ticket)}`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      alert(e.response?.data?.error || e.message || '下载失败');
    } finally { setBusy(null); }
  };

  const downloadMaster = async (country) => {
    setBusy('master-' + country);
    try {
      const { data } = await api.post(`/inventory/master/${encodeURIComponent(country)}/ticket`);
      const a = document.createElement('a');
      a.href = `/api/inventory/master/${encodeURIComponent(country)}?ticket=${encodeURIComponent(data.ticket)}`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      alert(e.response?.data?.error || e.message || '下载失败');
    } finally { setBusy(null); }
  };

  const downloadFeed = async (country) => {
    setBusy(country);
    try {
      const { data } = await api.post(`/inventory/${encodeURIComponent(country)}/ticket`);
      const a = document.createElement('a');
      a.href = `/api/inventory/${encodeURIComponent(country)}?ticket=${encodeURIComponent(data.ticket)}`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      alert(e.response?.data?.error || e.message || '下载失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">下载支持</h1>
        <p className="text-gray-500 text-sm">下载库存价格更新数据和工具文件</p>
      </div>

      <div className="bg-white rounded-xl shadow border-l-4 border-blue-500 p-5">
        <h2 className="font-semibold mb-3 text-blue-600">🌐 库存价格更新下载</h2>
        <p className="text-sm text-gray-600 mb-4">下载各国库存价格更新数据 (XLSX 格式)。仅包含该国销售总表中的 SKU。</p>
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
                  🌐 {c.name} 库存价格更新 <span>{busy === c.name ? '...' : '⬇️'}</span>
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
        <p className="text-sm text-gray-600 mb-4">含 SKU 白名单 + 主图链接的精选目录。</p>
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
        <p className="text-sm text-gray-600 mb-4">下载蓝鲸工具客户端安装程序{isOwner ? '（店主可在右侧上传新版）' : ''}</p>
        <div className="grid grid-cols-4 gap-3">
          <button
            onClick={downloadInstaller}
            disabled={!installer?.available || busy === 'installer'}
            className={`rounded-lg py-3 px-4 flex flex-col items-start gap-1 transition ${
              !installer?.available || busy === 'installer'
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            <span className="w-full flex justify-between items-center font-medium">
              📄 蓝鲸工具安装EXE <span>{busy === 'installer' ? '...' : '⬇️'}</span>
            </span>
            <span className="text-xs opacity-80">
              {installer?.available
                ? `${(installer.size / (1024 * 1024)).toFixed(1)} MB · ${new Date(installer.uploaded_at).toLocaleDateString()}`
                : '尚未上传'}
            </span>
          </button>

          {isOwner && (
            <>
              <input
                ref={installerInputRef}
                type="file"
                accept=".exe,.msi"
                className="hidden"
                onChange={onPickInstaller}
              />
              <button
                onClick={() => installerInputRef.current?.click()}
                disabled={uploadingInstaller}
                className={`rounded-lg py-3 px-4 flex flex-col items-start gap-1 transition border-2 border-dashed ${
                  uploadingInstaller
                    ? 'border-gray-300 text-gray-400 cursor-not-allowed'
                    : 'border-blue-400 text-blue-600 hover:bg-blue-50'
                }`}
              >
                <span className="w-full flex justify-between items-center font-medium">
                  📤 {installer?.available ? '替换安装包' : '上传安装包'}
                  <span>{uploadingInstaller ? '上传中...' : '+'}</span>
                </span>
                <span className="text-xs opacity-80">仅店主可见 · 单个文件 ≤ 500MB</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
