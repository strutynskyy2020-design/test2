import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2, Zap, ChevronLeft, Camera, User, Mail, Phone, Send, Users as UsersIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { extractError, setToken, API_BASE } from "@/lib/api";
import { useApp } from "@/context/AppContext";

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
  const { refreshMe } = useApp();
  const nav = useNavigate();
  const [teams, setTeams] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
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

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Файл більше 15 МБ");
      return;
    }
    setUploadingAvatar(true);
    try {
      // Public endpoint requires auth; register first, then upload after (fallback: skip)
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", "avatars");
      const { data } = await api.post("/uploads", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setField("avatar_url", data.url);
      toast.success("Аватар завантажено");
    } catch (e) {
      // If unauthorized (before signup), tell user we'll upload after sign-up
      const st = e?.response?.status;
      if (st === 401) {
        toast.error("Спочатку створи акаунт — аватар можна додати в профілі");
      } else {
        toast.error(extractError(e, "Не вдалось завантажити"));
      }
    } finally {
      setUploadingAvatar(false);
    }
  };

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
      setToken(data.token);
      await refreshMe?.();
      toast.success("Вітаємо в CallHub! +100 стартових балів");
      nav("/");
    } catch (err) {
      toast.error(extractError(err, "Не вдалось зареєструватися"));
    } finally {
      setBusy(false);
    }
  };

  const avatarPreviewUrl = f.avatar_url
    ? (f.avatar_url.startsWith("http") ? f.avatar_url : `${API_BASE.replace(/\/api$/, "")}${f.avatar_url}`)
    : null;

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
          <p className="text-zinc-400 text-sm mt-1 text-center">Приєднуйся до команди CallHub</p>
        </div>

        <form onSubmit={submit} className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-6 space-y-4">
          {/* Avatar picker */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">Аватар</label>
            <div className="flex items-center gap-3">
              <label
                data-testid="avatar-picker"
                className="relative w-20 h-20 rounded-2xl flex items-center justify-center font-display text-2xl text-[#0A0A0A] cursor-pointer overflow-hidden border-b-4"
                style={{ backgroundColor: f.avatar_color, borderColor: "#00000055" }}
              >
                {avatarPreviewUrl ? (
                  <img src={avatarPreviewUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{initials}</span>
                )}
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-tl-lg bg-[#0A0A0A] flex items-center justify-center border-t border-l border-white/10">
                  {uploadingAvatar ? <Loader2 size={12} className="animate-spin text-white" /> : <Camera size={12} strokeWidth={3} color="#FFB800" />}
                </div>
                <input
                  data-testid="avatar-file-input"
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => uploadAvatar(e.target.files?.[0])}
                />
              </label>
              <div className="flex-1 grid grid-cols-6 gap-1.5">
                {AVATAR_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    data-testid={`color-${c}`}
                    onClick={() => setField("avatar_color", c)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform active:scale-90 ${f.avatar_color === c ? "border-white" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={`color ${c}`}
                  />
                ))}
              </div>
            </div>
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
            {busy ? "Реєструємо..." : "УВІЙТИ В ГРУ"}
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
