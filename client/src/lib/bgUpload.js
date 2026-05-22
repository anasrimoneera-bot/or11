// 后台上传跟踪器：跨组件、跨页面切换保持上传 promise 活着
// （刷新页面会丢，因为 axios XHR 在 window unload 时被浏览器取消）
const active = new Map();   // key -> { promise, label }
const listeners = new Set();

function notify() { for (const cb of listeners) try { cb(); } catch {} }

export const bgUpload = {
  start(key, promise, label) {
    active.set(key, { promise, label });
    notify();
    const cleanup = () => { active.delete(key); notify(); };
    promise.then(cleanup, cleanup);
    return promise;
  },
  isActive(key) { return active.has(key); },
  list() { return Array.from(active.entries()).map(([k, v]) => ({ key: k, label: v.label })); },
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

// 全局事件：上传完成后广播，AdminProducts 可监听刷新 status
export const onUploadFinished = (cb) => {
  const handler = (e) => cb(e.detail);
  window.addEventListener('bgUploadFinished', handler);
  return () => window.removeEventListener('bgUploadFinished', handler);
};

export const emitUploadFinished = (detail) => {
  window.dispatchEvent(new CustomEvent('bgUploadFinished', { detail }));
};
