import { useEffect, useState } from "react";
import { Loader2, Newspaper } from "lucide-react";
import api, { extractError } from "@/lib/api";
import { toast } from "sonner";
import FeedItem from "@/components/FeedItem";
export { default as FeedItem } from "@/components/FeedItem";

export default function Feed() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/feed", { params: { limit: 60 } });
      setEvents(data.events || []);
    } catch (e) {
      toast.error(extractError(e, "Не вдалося завантажити стрічку"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = [
    { key: "all", label: "Все", color: "#F5F5F5" },
    { key: "quest", label: "Квести", color: "#6D3DF5" },
    { key: "level_up", label: "Рівні", color: "#FF5C00" },
    { key: "purchase", label: "Покупки", color: "#00F0FF" },
    { key: "cube", label: "Куб", color: "#FFB800" },
  ];

  const filtered = filter === "all" ? events : events.filter((e) => e.kind === filter);

  return (
    <div className="px-5 pt-2 pb-8 space-y-4">
      <section
        className="bg-gradient-to-r from-[#6D3DF5]/12 to-transparent border border-[#6D3DF5]/25 rounded-3xl p-4 flex items-center gap-3"
        data-testid="feed-header"
      >
        <div className="w-12 h-12 rounded-2xl bg-[#6D3DF5] flex items-center justify-center">
          <Newspaper size={24} strokeWidth={3} color="#FFFFFF" />
        </div>
        <div className="flex-1">
          <div className="text-white font-display text-lg leading-none">СТРІЧКА</div>
          <div className="text-zinc-400 text-xs mt-1">Що відбувається в команді прямо зараз</div>
        </div>
      </section>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" data-testid="feed-filters">
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              data-testid={`feed-filter-${f.key}`}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest transition-transform active:scale-95 ${
                active ? "text-[#0A0A0A]" : "text-zinc-400 border-white/10 bg-[#1A1A1E]"
              }`}
              style={active ? { backgroundColor: f.color, borderColor: f.color } : {}}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 gap-2" data-testid="feed-loading">
          <Loader2 className="animate-spin" size={18} />
          <span className="text-xs font-black uppercase tracking-widest">Завантаження...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-8 text-center"
          data-testid="feed-empty"
        >
          <div className="text-zinc-500 text-sm">Поки що тут порожньо</div>
          <div className="text-zinc-600 text-xs mt-1">Виконуй квести — і твоя активність з'явиться першою!</div>
        </div>
      ) : (
        <ul className="space-y-2.5" data-testid="feed-list">
          {filtered.map((ev) => (
            <FeedItem key={ev.id} ev={ev} />
          ))}
        </ul>
      )}
    </div>
  );
}
