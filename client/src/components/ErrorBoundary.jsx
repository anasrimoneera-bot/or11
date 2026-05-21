import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught:', error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-900">
          <div className="text-lg font-semibold mb-2">😵 页面出现异常</div>
          <div className="text-sm mb-3">
            渲染当前页面时出现了一个错误，刷新或返回上一页可恢复。如果反复出现，请把下方错误信息截图给开发者。
          </div>
          <pre className="bg-white border border-red-200 rounded p-3 text-xs overflow-x-auto max-h-48">
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => location.reload()} className="btn btn-primary">🔄 刷新页面</button>
            <button onClick={() => { this.reset(); history.back(); }} className="btn btn-ghost">← 返回上一页</button>
            <button onClick={this.reset} className="btn btn-ghost">✕ 关闭错误</button>
          </div>
        </div>
      </div>
    );
  }
}
