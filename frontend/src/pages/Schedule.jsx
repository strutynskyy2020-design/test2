import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coffee,
  MapPin,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import PalmOnSandIcon from "@/components/PalmOnSandIcon";
import { getToken } from "@/lib/api";
import {
  addIsoDays,
  buildMonthCells,
  formatFullDate,
  formatMonthTitle,
  formatShiftTime,
  getScheduleMonths,
  getScheduleStatus,
  kyivTodayIso,
  monthKeyFromIso,
} from "@/lib/workSchedule";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

const StatusIcon = ({ type, size = 22, strokeWidth = 2.5 }) => {
  const props = { size, strokeWidth };
  if (type === "late_shift") return <CalendarClock {...props} />;
  if (type === "weekend_shift") return <CalendarDays {...props} />;
  if (type === "vacation") return <PalmOnSandIcon {...props} strokeWidth={Math.max(1.8, strokeWidth - 0.15)} />;
  if (type === "day_off") return <Coffee {...props} />;
  return <BriefcaseBusiness {...props} />;
};

const fetchSchedule = async () => {
  const token = getToken();
  if (!token) throw new Error("Потрібна авторизація");
  const response = await fetch(`/.netlify/functions/google-goals?_ts=${Date.now()}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "cache-control": "no-cache",
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Не вдалося завантажити графік");
  }
  return data.schedule || null;
};

const DaySummary = ({ title, day }) => {
  const status = getScheduleStatus(day);
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#1A1A1E] p-3.5">
      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{title}</div>
      <div className="mt-2 flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border"
          style={{ color: status.color, background: status.soft, borderColor: status.border }}
        >
          <StatusIcon type={day?.type} size={21} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{status.label}</div>
          <div className="mt-0.5 truncate text-xs font-bold" style={{ color: status.color }}>
            {day ? formatShiftTime(day) : "Немає даних"}
          </div>
        </div>
      </div>
    </div>
  );
};

const LegendItem = ({ type, label }) => {
  const status = getScheduleStatus({ type });
  return (
    <div className="flex items-center gap-2 text-[10px] font-black text-zinc-500">
      <span className="h-3 w-3 rounded-[4px] border" style={{ background: status.soft, borderColor: status.border }} />
      <span>{label}</span>
    </div>
  );
};

export default function Schedule() {
  const nav = useNavigate();
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [activeMonth, setActiveMonth] = useState("");
  const todayIso = useMemo(() => kyivTodayIso(), []);

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await fetchSchedule();
      setSchedule(next);
      const dates = Array.isArray(next?.days) ? next.days.map((day) => day.date).filter(Boolean) : [];
      const preferred = dates.includes(todayIso) ? todayIso : dates[0] || "";
      setSelectedDate((current) => (current && dates.includes(current) ? current : preferred));
      setActiveMonth((current) => current || monthKeyFromIso(preferred));
    } catch (err) {
      setError(err?.message || "Не вдалося завантажити графік");
      if (quiet) toast.error(err?.message || "Не вдалося оновити графік");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const initialLoad = async () => {
      setLoading(true);
      try {
        const next = await fetchSchedule();
        if (cancelled) return;
        setSchedule(next);
        const dates = Array.isArray(next?.days) ? next.days.map((day) => day.date).filter(Boolean) : [];
        const preferred = dates.includes(todayIso) ? todayIso : dates[0] || "";
        setSelectedDate(preferred);
        setActiveMonth(monthKeyFromIso(preferred));
      } catch (err) {
        if (!cancelled) setError(err?.message || "Не вдалося завантажити графік");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    initialLoad();

    const refresh = () => {
      if (document.visibilityState === "visible") load({ quiet: true });
    };
    const timer = window.setInterval(() => load({ quiet: true }), 5 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = Array.isArray(schedule?.days) ? schedule.days : [];
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const months = useMemo(() => getScheduleMonths(schedule), [schedule]);
  const currentMonthIndex = Math.max(0, months.indexOf(activeMonth));
  const monthCells = useMemo(() => buildMonthCells(activeMonth, schedule), [activeMonth, schedule]);
  const selectedDay = byDate.get(selectedDate) || null;
  const today = byDate.get(todayIso) || null;
  const tomorrow = byDate.get(addIsoDays(todayIso, 1)) || null;

  const changeMonth = (delta) => {
    if (!months.length) return;
    const nextIndex = Math.max(0, Math.min(months.length - 1, currentMonthIndex + delta));
    const nextMonth = months[nextIndex];
    setActiveMonth(nextMonth);
    const firstDay = days.find((day) => monthKeyFromIso(day.date) === nextMonth);
    if (firstDay) setSelectedDate(firstDay.date);
  };

  if (loading) {
    return (
      <div className="px-5 py-8">
        <div className="h-24 animate-pulse rounded-3xl border border-white/10 bg-[#1A1A1E]" />
        <div className="mt-4 h-[430px] animate-pulse rounded-3xl border border-white/10 bg-[#1A1A1E]" />
      </div>
    );
  }

  return (
    <div className="space-y-5 px-5 pb-10 pt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="app-header-action flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95"
          aria-label="Назад"
        >
          <ArrowLeft size={20} strokeWidth={2.8} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-display text-2xl text-white">МІЙ ГРАФІК</div>
          <div className="mt-1 truncate text-xs font-bold text-zinc-500">
            {schedule?.employee?.name || schedule?.employee?.login || "Робочий календар"}
            {schedule?.employee?.rate ? ` • ставка ${schedule.employee.rate}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => load({ quiet: true })}
          className="app-header-action flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-[#6D3DF5] active:scale-95"
          aria-label="Оновити графік"
        >
          <RefreshCcw size={19} strokeWidth={2.6} />
        </button>
      </div>

      {error ? (
        <section className="rounded-3xl border border-[#EF5350]/30 bg-[#EF5350]/10 p-5">
          <div className="font-black text-[#EF5350]">Графік не завантажився</div>
          <div className="mt-1 text-sm text-zinc-500">{error}</div>
          <button type="button" onClick={() => load()} className="mt-4 rounded-2xl bg-[#6D3DF5] px-4 py-3 text-xs font-black text-white">
            Спробувати ще раз
          </button>
        </section>
      ) : !schedule?.found ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-6 text-center">
          <CalendarDays className="mx-auto text-[#6D3DF5]" size={34} />
          <div className="mt-3 font-display text-lg text-white">Графік не знайдено</div>
          <div className="mt-2 text-sm leading-relaxed text-zinc-500">
            Перевірте, чи логін профілю збігається з колонкою «Логін» на вкладці Schedule.
          </div>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3">
            <DaySummary title="Сьогодні" day={today} />
            <DaySummary title="Завтра" day={tomorrow} />
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4 shadow-[0_14px_36px_rgba(44,44,60,.06)]">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={currentMonthIndex <= 0}
                onClick={() => changeMonth(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-[#8B5CF6] disabled:opacity-25"
                aria-label="Попередній місяць"
              >
                <ChevronLeft size={19} strokeWidth={3} />
              </button>
              <div className="text-center font-display text-base text-white">{formatMonthTitle(activeMonth)}</div>
              <button
                type="button"
                disabled={currentMonthIndex >= months.length - 1}
                onClick={() => changeMonth(1)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-[#8B5CF6] disabled:opacity-25"
                aria-label="Наступний місяць"
              >
                <ChevronRight size={19} strokeWidth={3} />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="pb-1 text-center text-[10px] font-black uppercase text-zinc-500">{weekday}</div>
              ))}
              {monthCells.map((cell, index) => {
                if (!cell) return <div key={`blank-${index}`} className="aspect-square" />;
                const day = cell.schedule;
                const status = getScheduleStatus(day);
                const isSelected = selectedDate === cell.date;
                const isToday = todayIso === cell.date;
                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => setSelectedDate(cell.date)}
                    className="relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-xl border text-center transition-transform active:scale-95"
                    style={{
                      color: day ? status.color : "#8A8E99",
                      background: day ? status.soft : "rgba(112,115,138,.05)",
                      borderColor: isSelected ? "#6D3DF5" : day ? status.border : "rgba(112,115,138,.10)",
                      boxShadow: isSelected ? "0 0 0 2px rgba(109,61,245,.18)" : "none",
                    }}
                  >
                    <span className="text-[11px] font-black leading-none">{cell.day}</span>
                    {day && <span className="mt-1"><StatusIcon type={day.type} size={14} strokeWidth={2.8} /></span>}
                    {isToday && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#6D3DF5]" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/10 pt-4">
              <LegendItem type="work" label="Звичайна зміна" />
              <LegendItem type="late_shift" label="11:00–20:00" />
              <LegendItem type="weekend_shift" label="10:00–19:00" />
              <LegendItem type="vacation" label="Відпустка" />
              <LegendItem type="day_off" label="Вихідний" />
            </div>
          </section>

          {selectedDay && (() => {
            const status = getScheduleStatus(selectedDay);
            return (
              <section
                className="overflow-hidden rounded-3xl border bg-[#1A1A1E] p-5"
                style={{ borderColor: status.border, boxShadow: `0 12px 34px ${status.soft}` }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border"
                    style={{ color: status.color, background: status.soft, borderColor: status.border }}
                  >
                    <StatusIcon type={selectedDay.type} size={29} strokeWidth={2.6} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Деталі дня</div>
                    <div className="mt-1 font-display text-lg leading-tight text-white">{formatFullDate(selectedDay.date)}</div>
                    <div className="mt-1 text-sm font-black" style={{ color: status.color }}>{status.label}</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Час</div>
                  <div className="mt-1 text-xl font-black text-white">{formatShiftTime(selectedDay)}</div>
                </div>

                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <MapPin size={18} className="shrink-0 text-[#8B5CF6]" />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Джерело</div>
                    <div className="mt-0.5 text-sm font-black text-white">Google Таблиця • вкладка Schedule</div>
                  </div>
                </div>
              </section>
            );
          })()}

          <div className="px-1 text-center text-[10px] font-bold text-zinc-500">
            Оновлено: {schedule.updated_at || "щойно"}. Порожня клітинка у таблиці відображається як вихідний.
          </div>
        </>
      )}
    </div>
  );
}
