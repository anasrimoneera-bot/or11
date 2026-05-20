const countries = [
  { name: '美国', code: 'US' }, { name: '英国', code: 'GB' }, { name: '德国', code: 'DE' },
  { name: '法国', code: 'FR' }, { name: '荷兰', code: 'NL' }, { name: '意大利', code: 'IT' },
  { name: '西班牙', code: 'ES' }, { name: '波兰', code: 'PL' },
];

export default function Downloads() {
  const downloadFeed = (code) => {
    alert(`下载 ${code} 库存数据。当DropXL API开放feed下载后此按钮将直接调用接口。`);
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">下载支持</h1>
        <p className="text-gray-500 text-sm">下载库存更新数据和工具文件</p>
      </div>

      <div className="bg-white rounded-xl shadow border-l-4 border-blue-500 p-5">
        <h2 className="font-semibold mb-3 text-blue-600">🌐 库存更新下载</h2>
        <p className="text-sm text-gray-600 mb-4">下载各国库存更新数据 (XLSX 格式)</p>
        <div className="grid grid-cols-4 gap-3">
          {countries.map(c => (
            <button key={c.code} onClick={() => downloadFeed(c.code)} className="bg-blue-500 text-white rounded-lg py-3 px-4 flex justify-between items-center hover:bg-blue-600">
              🌐 {c.name} 库存更新 <span>⬇️</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border-l-4 border-green-500 p-5">
        <h2 className="font-semibold mb-3 text-green-600">📄 工具文件下载</h2>
        <p className="text-sm text-gray-600 mb-4">下载表格制作工具和库存更新工具</p>
        <div className="grid grid-cols-4 gap-3">
          <button onClick={() => alert('表格制作工具下载')} className="bg-green-500 text-white rounded-lg py-3 px-4 flex justify-between items-center hover:bg-green-600">
            📄 表格制作工具 <span>⬇️</span>
          </button>
          <button onClick={() => alert('库存更新工具下载')} className="bg-green-500 text-white rounded-lg py-3 px-4 flex justify-between items-center hover:bg-green-600">
            📄 库存更新工具 <span>⬇️</span>
          </button>
        </div>
      </div>
    </div>
  );
}
