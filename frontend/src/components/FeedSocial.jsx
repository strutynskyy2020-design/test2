import { useState } from "react";
import {
  ThumbsUp, Flame, PartyPopper, Rocket, Heart, Laugh, Star,
  MessageCircle, SmilePlus, Send, Loader2, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";

export const REACTIONS = {
  like: { Icon: ThumbsUp, color: "#00F0FF", label: "Лайк" },
  fire: { Icon: Flame, color: "#FF5C00", label: "Вогонь" },
  clap: { Icon: PartyPopper, color: "#FFB800", label: "Аплодисменти" },
  rocket: { Icon: Rocket, color: "#B78CFF", label: "Ракета" },
  heart: { Icon: Heart, color: "#FF3B8A", label: "Серце" },
  laugh: { Icon: Laugh, color: "#39FF14", label: "Сміх" },
  star: { Icon: Star, color: "#FFD700", label: "Зірка" },
};

const relTime = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "щойно";
  if (s < 3600) return `${Math.floor(s / 60)} хв`;
  if (s < 86400) return `${Math.floor(s / 3600)} год`;
  return `${Math.floor(s / 86400)} дн`;
};

export default function FeedSocial({ ev }) {
  const { user } = useApp();
  const [reactions, setReactions] = useState(ev.reactions || {});
  const [mine, setMine] = useState(ev.my_reaction || null);
  const [picker, setPicker] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [count, setCount] = useState(ev.comment_count || 0);
  const [text, setText] = useState("");
  const [loadingC, setLoadingC] = useState(false);
  const [sending, setSending] = useState(false);

  const react = async (emoji) => {
    setPicker(false);
    try {
      const { data } = await api.post(`/feed/${ev.id}/react`, { emoji });
      setReactions(data.reactions || {});
      setMine(data.my_reaction);
    } catch (e) { toast.error(extractError(e)); }
  };

  const toggleComments = async () => {
    const next = !showComments;
    setShowComments(next);
    if (next && comments.length === 0) {
      setLoadingC(true);
      try { const { data } = await api.get(`/feed/${ev.id}/comments`); setComments(data || []); }
      catch (e) { toast.error(extractError(e)); }
      setLoadingC(false);
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      const { data } = await api.post(`/feed/${ev.id}/comments`, { text: t });
      setComments((s) => [...s, data]);
      setCount((c) => c + 1);
      setText("");
    } catch (e) { toast.error(extractError(e)); }
    setSending(false);
  };

  const del = async (c) => {
    try {
      await api.delete(`/comments/${c.id}`);
      setComments((s) => s.filter((x) => x.id !== c.id));
      setCount((n) => Math.max(0, n - 1));
    } catch (e) { toast.error(extractError(e)); }
  };

  const activeReactions = Object.entries(reactions).filter(([, n]) => n > 0);
  const totalReacts = activeReactions.reduce((a, [, n]) => a + n, 0);

  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <div className="flex items-center gap-2 flex-wrap">
        {/* existing reaction chips */}
        {activeReactions.map(([key, n]) => {
          const r = REACTIONS[key]; if (!r) return null;
          const RIcon = r.Icon;
          const isMine = mine === key;
          return (
            <button
              key={key}
              data-testid={`reaction-chip-${ev.id}-${key}`}
              onClick={() => react(key)}
              className={`h-8 px-2.5 rounded-full flex items-center gap-1 border-2 transition-transform active:scale-90 ${isMine ? "" : "border-white/10 bg-[#0A0A0A]"}`}
              style={isMine ? { borderColor: r.color, background: r.color + "22" } : {}}
            >
              <RIcon size={14} strokeWidth={2.75} color={r.color} />
              <span className="text-xs font-black" style={{ color: isMine ? r.color : "#a1a1aa" }}>{n}</span>
            </button>
          );
        })}

        {/* react button + picker */}
        <div className="relative">
          <button
            data-testid={`react-btn-${ev.id}`}
            onClick={() => setPicker((p) => !p)}
            className="h-8 px-2.5 rounded-full bg-[#0A0A0A] border-2 border-white/10 text-zinc-400 flex items-center gap-1 active:scale-90 transition-transform"
          >
            <SmilePlus size={15} strokeWidth={2.75} />
            {totalReacts === 0 && <span className="text-[11px] font-black uppercase">Реакція</span>}
          </button>
          {picker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPicker(false)} />
              <div data-testid={`reaction-picker-${ev.id}`} className="absolute z-50 bottom-10 left-0 bg-[#1A1A1E] border-2 border-white/10 rounded-2xl p-2 flex gap-1 shadow-xl">
                {Object.entries(REACTIONS).map(([key, r]) => {
                  const RIcon = r.Icon;
                  return (
                    <button
                      key={key}
                      data-testid={`react-opt-${ev.id}-${key}`}
                      onClick={() => react(key)}
                      title={r.label}
                      className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform hover:bg-white/5"
                    >
                      <RIcon size={20} strokeWidth={2.75} color={r.color} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* comments toggle */}
        <button
          data-testid={`comment-btn-${ev.id}`}
          onClick={toggleComments}
          className="h-8 px-2.5 rounded-full bg-[#0A0A0A] border-2 border-white/10 text-zinc-400 flex items-center gap-1 ml-auto active:scale-90 transition-transform"
        >
          <MessageCircle size={15} strokeWidth={2.75} />
          <span className="text-xs font-black">{count}</span>
        </button>
      </div>

      {showComments && (
        <div className="mt-3 space-y-2.5" data-testid={`comments-${ev.id}`}>
          {loadingC && <div className="flex items-center gap-2 text-zinc-500 text-xs"><Loader2 size={14} className="animate-spin" /> Завантаження...</div>}
          {!loadingC && comments.length === 0 && <div className="text-zinc-600 text-xs">Ще немає коментарів. Будь першим!</div>}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2" data-testid={`comment-${c.id}`}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[10px] text-[#0A0A0A] shrink-0" style={{ backgroundColor: c.avatar_color }}>{c.avatar_initials}</div>
              <div className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-white font-black text-xs truncate">{c.user_name}</span>
                  <span className="text-zinc-600 text-[10px] font-black uppercase">{relTime(c.created_at)}</span>
                  {(c.user_id === user?.id || user?.role === "admin") && (
                    <button data-testid={`del-comment-${c.id}`} onClick={() => del(c)} className="ml-auto text-zinc-600 hover:text-[#FF3B30]"><Trash2 size={12} strokeWidth={3} /></button>
                  )}
                </div>
                <div className="text-zinc-300 text-sm mt-0.5 break-words">{c.text}</div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              data-testid={`comment-input-${ev.id}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Написати коментар..."
              maxLength={500}
              className="flex-1 h-10 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white text-sm placeholder:text-zinc-600 focus:border-[#FFB800] outline-none"
            />
            <button data-testid={`comment-send-${ev.id}`} onClick={send} disabled={sending || !text.trim()} className="w-10 h-10 rounded-xl bg-[#FFB800] border-b-4 border-[#7a5900] text-[#0A0A0A] flex items-center justify-center active:border-b-0 active:translate-y-1 disabled:opacity-50">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={3} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
