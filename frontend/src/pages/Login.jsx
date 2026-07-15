import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";

export default function Login() {
  const { login, user } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (!result.ok) {
        toast.error(result.error || "Невірний email або пароль", { duration: 2500 });
        return;
      }

      toast.success("Ласкаво просимо в TM6 Bonus!");
      nav("/", { replace: true });
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Не вдалося виконати вхід. Спробуйте ще раз.", { duration: 2500 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-[#FFB800] flex items-center justify-center glow-yellow border-b-4 border-[#7a5900] mb-4">
            <Gamepad2 size={40} strokeWidth={3} color="#0A0A0A" aria-hidden="true" />
          </div>
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">TM6 Bonus</div>
          <h1 className="font-display text-4xl text-white mt-1">TM6 BONUS</h1>
          <p className="text-zinc-400 text-sm mt-2">Заходь. Заробляй. Прокачуйся.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-6 space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">
              Email
            </label>
            <input
              id="login-email"
              data-testid="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Введіть email"
              disabled={loading}
              className="w-full h-14 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none transition-colors disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">
              Пароль
            </label>
            <input
              id="login-password"
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введіть пароль"
              disabled={loading}
              className="w-full h-14 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none transition-colors disabled:opacity-60"
            />
          </div>
          <button
            data-testid="login-submit"
            type="submit"
            disabled={loading}
            className="arcade-btn w-full h-14 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Zap size={18} strokeWidth={3} aria-hidden="true" />
            {loading ? "Вхід..." : "УВІЙТИ В ГРУ"}
          </button>

          <button
            type="button"
            data-testid="login-to-register"
            onClick={() => nav("/register")}
            disabled={loading}
            className="w-full h-11 bg-transparent border-2 border-[#39FF14]/40 text-[#39FF14] font-black text-xs uppercase tracking-wider rounded-xl active:scale-95 transition-transform disabled:opacity-60"
          >
            Створити акаунт
          </button>
        </form>
      </div>
    </div>
  );
}
