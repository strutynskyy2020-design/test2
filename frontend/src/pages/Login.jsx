import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Gamepad2, Shield } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";

const DEMO_ACCOUNTS = [
  { email: "anna@callhub.ua", password: "demo123", name: "Анна Коваль", initials: "АК", color: "#FFB800", role: "Оператор" },
  { email: "maks@callhub.ua", password: "demo123", name: "Максим Дубенко", initials: "МД", color: "#00F0FF", role: "Senior оператор" },
  { email: "olena@callhub.ua", password: "demo123", name: "Олена Ткач", initials: "ОТ", color: "#39FF14", role: "Оператор" },
  { email: "admin@callhub.ua", password: "admin123", name: "Адміністратор", initials: "АД", color: "#FF5C00", role: "Admin" },
];

export default function Login() {
  const { login, user, mode } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error, { duration: 2500 });
      return;
    }
    toast.success(res.mode === "mock" ? "Ласкаво просимо (офлайн-режим)" : "Ласкаво просимо в гру!");
    nav("/");
  };

  const fillDemo = (u) => {
    setEmail(u.email);
    setPassword(u.password);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-[#FFB800] flex items-center justify-center glow-yellow border-b-4 border-[#7a5900] mb-4">
            <Gamepad2 size={40} strokeWidth={3} color="#0A0A0A" />
          </div>
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            CallHub {mode === "mock" && <span className="text-[#FF5C00]">• OFFLINE</span>}
          </div>
          <h1 className="font-display text-4xl text-white mt-1">GAME HUB</h1>
          <p className="text-zinc-400 text-sm mt-2">Заходь. Заробляй. Прокачуйся.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">Email</label>
            <input
              data-testid="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="anna@callhub.ua"
              className="w-full h-14 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">Пароль</label>
            <input
              data-testid="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="demo123"
              className="w-full h-14 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none transition-colors"
            />
          </div>
          <button
            data-testid="login-submit"
            type="submit"
            disabled={loading}
            className="arcade-btn w-full h-14 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Zap size={18} strokeWidth={3} />
            {loading ? "Вхід..." : "УВІЙТИ В ГРУ"}
          </button>

          <button
            type="button"
            data-testid="login-to-register"
            onClick={() => nav("/register")}
            className="w-full h-11 bg-transparent border-2 border-[#39FF14]/40 text-[#39FF14] font-black text-xs uppercase tracking-wider rounded-xl active:scale-95 transition-transform"
          >
            Створити акаунт
          </button>
        </form>

        <div className="mt-6">
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-3 px-1">Демо-акаунти</div>
          <div className="space-y-2">
            {DEMO_ACCOUNTS.map((u) => (
              <button
                key={u.email}
                data-testid={`demo-account-${u.email}`}
                onClick={() => fillDemo(u)}
                className="w-full flex items-center gap-3 p-3 bg-[#1A1A1E] border border-white/10 rounded-2xl hover:border-[#FFB800]/50 active:scale-[0.98] transition-all text-left"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center font-display text-sm text-[#0A0A0A]"
                  style={{ backgroundColor: u.color }}
                >
                  {u.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-black text-sm truncate flex items-center gap-1.5">
                    {u.name}
                    {u.role === "Admin" && <Shield size={12} strokeWidth={3} className="text-[#FF5C00]" />}
                  </div>
                  <div className="text-zinc-500 text-xs truncate">{u.email} • {u.password}</div>
                </div>
                <div className="text-[10px] font-black uppercase text-[#FFB800]">Заповнити</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
