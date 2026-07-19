import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2, Zap, ChevronLeft, User, Mail, Phone, Send, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";

const AVATAR_COLORS = ["#FFB800", "#00F0FF", "#39FF14", "#FF5C00", "#B78CFF", "#FF3B8A"];

const Field = ({ label, icon: Icon, ...props }) => (
  <div>
    <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">{label}</label>
    <div className="relative">
      {Icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
          <Icon size={16} strokeWidth={2.75} />
        </div>
      )}
      <input
        {...props}
        className={`w-full h-12 ${Icon ? "pl-10" : "pl-4"} pr-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none transition-colors`}
      />
    </div>
  </div>
);

export default function Register() {
  const nav = useNavigate();
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    phone: "",
    telegram: "",
    position: "Оператор",
    team_id: "",
    avatar_url: null,
    avatar_color: AVATAR_COLORS[0],
  });

  useEffect(() => {
    api.get("/teams")
      .then((r) => setTeams(r.data || []))
      .catch(() => setTeams([]));
  }, []);

  const initials = ((f.first_name[0] || "") + (f.last_name[0] || "")).toUpperCase() || "??";

  const setField = (k, v) => setF((s) => ({ ...s, [k]: v }));


  const submit = async (e) => {
    e?.preventDefault?.();
    if (!f.first_name.trim() || !f.last_name.trim()) {
      toast.error("Заповни ім'я та прізвище");
      return;
    }
    if (f.password.length < 6) {
      toast.error("Пароль щонайменше 6 символів");
      return;
    }
    setBusy(true);
    try {
      const body = { ...f, team_id: f.team_id || null };
      const { data } = await api.post("/auth/register/self", body);
      toast.success(data.message || "Реєстрацію надіслано!", { duration: 4000 });
      nav("/login");
    } catch (err) {
      toast.error(extractError(err, "Не вдалось зареєструватися"));
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="min-h-screen w-full flex items-start justify-center px-5 py-8">
      <div className="w-full max-w-[420px]">
        <button
          onClick={() => nav("/login")}
          data-testid="register-back"
          className="text-zinc-500 flex items-center gap-1 text-xs font-black uppercase tracking-widest mb-4 active:scale-95"
        >
          <ChevronLeft size={14} strokeWidth={3} /> Назад
        </button>

        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-3xl bg-[#39FF14] flex items-center justify-center border-b-4 border-[#1a7a0a] mb-3">
            <Gamepad2 size={32} strokeWidth={3} color="#0A0A0A" />
          </div>
          <h1 className="font-display text-3xl text-white">Реєстрація</h1>
          <p className="text-zinc-400 text-sm mt-1 text-center">Приєднуйся до команди TM6 Bonus</p>
        </div>

        <div className="bg-[#FFB800]/10 border-2 border-[#FFB800]/30 rounded-2xl px-4 py-3 mb-4 text-[#FFB800] text-xs font-bold text-center">
          Після реєстрації акаунт активується адміністратором. Ми повідомимо, коли можна увійти.
        </div>

        <form onSubmit={submit} className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-6 space-y-4">
          <div className="rounded-2xl border border-[#00F0FF]/25 bg-[#00F0FF]/8 px-4 py-3 text-xs font-semibold leading-relaxed text-zinc-300">
            Після активації акаунта обери аватар у магазині. Власні фото для аватара недоступні.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ім'я" icon={User} data-testid="reg-first" value={f.first_name} onChange={(e) => setField("first_name", e.target.value)} placeholder="Іван" required />
            <Field label="Прізвище" icon={User} data-testid="reg-last" value={f.last_name} onChange={(e) => setField("last_name", e.target.value)} placeholder="Петров" required />
          </div>

          <Field label="Email" icon={Mail} type="email" data-testid="reg-email" value={f.email} onChange={(e) => setField("email", e.target.value)} placeholder="ivan@callhub.ua" required />
          <Field label="Пароль (мін. 6)" type="password" data-testid="reg-password" value={f.password} onChange={(e) => setField("password", e.target.value)} placeholder="••••••" required />

          <Field label="Телефон" icon={Phone} type="tel" data-testid="reg-phone" value={f.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="+380..." />
          <Field label="Telegram (username)" icon={Send} data-testid="reg-telegram" value={f.telegram} onChange={(e) => setField("telegram", e.target.value)} placeholder="@nickname" />

          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">Посада</label>
            <select
              data-testid="reg-position"
              value={f.position}
              onChange={(e) => setField("position", e.target.value)}
              className="w-full h-12 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none"
            >
              <option value="Оператор">Оператор</option>
              <option value="Senior оператор">Senior оператор</option>
              <option value="Стажер">Стажер</option>
              <option value="Тімлід">Тімлід</option>
              <option value="Супервайзер">Супервайзер</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5">
              <UsersIcon size={12} strokeWidth={3} /> Команда
            </label>
            <select
              data-testid="reg-team"
              value={f.team_id}
              onChange={(e) => setField("team_id", e.target.value)}
              className="w-full h-12 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none"
            >
              <option value="">— Без команди —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.member_count})</option>
              ))}
            </select>
            {teams.length === 0 && <div className="text-zinc-500 text-[11px] mt-1">Немає команд — адмін створить пізніше</div>}
          </div>

          <button
            data-testid="reg-submit"
            type="submit"
            disabled={busy}
            className="arcade-btn w-full h-14 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Zap size={18} strokeWidth={3} />
            {busy ? "Реєструємо..." : "ЗАРЕЄСТРУВАТИСЯ"}
          </button>
        </form>

        <div className="text-center mt-4">
          <button onClick={() => nav("/login")} className="text-zinc-400 text-xs font-black uppercase tracking-widest">
            Вже маєш акаунт? <span className="text-[#FFB800]">Увійти</span>
          </button>
        </div>
      </div>
    </div>
  );
}
