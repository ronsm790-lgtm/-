import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
            <h2 className="text-xl font-bold text-[#0B1F3A] mb-3">
              حدث خطأ غير متوقع في عرض الصفحة
            </h2>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              نعتذر عن هذا الخلل. يمكنك إعادة تحميل الصفحة للمتابعة بأمان.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#1E4E8C] transition-colors cursor-pointer"
            >
              إعادة تحميل البوابة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
