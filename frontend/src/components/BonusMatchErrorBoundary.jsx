import React from "react";
import { bonusMatchDiagnostics } from "@/lib/bonusMatchDiagnostics";

export default class BonusMatchErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    bonusMatchDiagnostics.reactError(error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-4 mt-6 rounded-3xl border border-[#FF4D55]/40 bg-[#2A0B10] p-5 text-center">
        <div className="text-lg font-black text-[#FF7A80]">Bonus Match зупинився</div>
        <div className="mt-2 text-sm text-zinc-400">Помилка збережена в діагностичному журналі.</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => bonusMatchDiagnostics.download({ source: "react-error-boundary" })}
            className="h-11 rounded-2xl bg-[#7C3AED] text-sm font-black text-white"
          >
            Завантажити лог
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-11 rounded-2xl border border-white/10 bg-[#17171B] text-sm font-black text-zinc-300"
          >
            Перезавантажити
          </button>
        </div>
      </div>
    );
  }
}
