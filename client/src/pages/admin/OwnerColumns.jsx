// 店主专属的表格列 - 通过 lazy load 隔离，员工不会下载此 chunk
export function UserMarkupHeader() {
  return <th className="px-3 py-2 text-right text-red-600">加价%</th>;
}

export function UserMarkupCell({ value }) {
  return <td className="px-3 py-2 text-right text-red-600 font-semibold">{value ?? 30}%</td>;
}

export function OrderRealHeader() {
  return (
    <>
      <th className="px-3 py-2 text-right text-red-600">真实(USD)</th>
      <th className="px-3 py-2 text-right text-red-600">加价%</th>
    </>
  );
}

export function OrderRealCells({ realUsd, markupPct }) {
  return (
    <>
      <td className="px-3 py-2 text-right text-red-600">${(realUsd || 0).toFixed(2)}</td>
      <td className="px-3 py-2 text-right text-red-600">{markupPct ?? 0}%</td>
    </>
  );
}

export default {};
