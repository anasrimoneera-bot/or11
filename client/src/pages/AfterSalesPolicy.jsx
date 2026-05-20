import { useState } from 'react';

const sections = [
  {
    title: '售后政策', body: `1. 客户收到商品后 30 天内可申请售后。
2. 售后申请需提供订单号、商品照片或视频证据。
3. 因物流损坏需要保留原始包装。
4. 退款将原路返回至账户余额。`
  },
  {
    title: '美国售后政策指南', body: `美国订单售后处理时效为 3-5 个工作日。
退货地址由DropXL平台分配，需提供有效的tracking number。
亚马逊A-to-Z申诉单需在24小时内同步告知。`
  },
  {
    title: '德国售后政策指南', body: `德国订单按欧盟消费者保护法处理。
14 天无理由退货，运费可由分销商承担。
请保留与买家的所有沟通记录。`
  },
  {
    title: '意大利、荷兰、法国售后政策指南', body: `按欧盟通用消费者权益保护处理。
请通过DropXL平台的工单系统沟通。
退款金额以欧元结算并按当日汇率折算人民币。` },
];

export default function AfterSalesPolicy() {
  const [open, setOpen] = useState(0);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">售后政策</h1>
        <p className="text-gray-500 text-sm">本页面包含 DropXL 的售后政策相关文档，包括美国、德国和意大利、荷兰、法国的售后政策指南。</p>
      </div>
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={i} className="bg-white rounded-lg shadow border">
            <button className="w-full p-4 flex justify-between items-center text-left" onClick={() => setOpen(open === i ? -1 : i)}>
              <span className="font-medium">📄 {s.title}</span>
              <span className={`transform transition ${open === i ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {open === i && <div className="p-4 pt-0 text-sm text-gray-700 whitespace-pre-line">{s.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
