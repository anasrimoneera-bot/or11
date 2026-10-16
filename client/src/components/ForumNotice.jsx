import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// 控制台顶部提示：问题论坛有别人新发的问题时显示，打开论坛后自动消失
export default function ForumNotice({ to }) {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/forum/unread').then(r => setD(r.data)).catch(() => {}); }, []);
  if (!d?.count) return null;

  return (
    <div onClick={() => navigate(to)}
      className="bg-amber-50 border border-amber-300 rounded-xl p-4 cursor-pointer hover:bg-amber-100 transition flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-amber-800">💬 问题论坛有 {d.count} 个新问题</div>
        <ul className="text-sm text-gray-700 mt-1 space-y-0.5">
          {d.latest.map(t => (
            <li key={t.id} className="truncate">· {t.title} <span className="text-xs text-gray-400">{t.created_at}</span></li>
          ))}
        </ul>
      </div>
      <span className="btn btn-warning text-sm shrink-0 self-start sm:self-center">去查看 →</span>
    </div>
  );
}
