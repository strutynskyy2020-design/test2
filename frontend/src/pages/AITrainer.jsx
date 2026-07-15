import { useMemo, useState } from "react";
import { Bot, ExternalLink, Copy, Check, Sparkles, Gauge, Flame, MessageSquareText } from "lucide-react";

const DEFAULT_GPT_URL = process.env.REACT_APP_TRAINER_GPT_URL || "https://chatgpt.com/";

const START_PROMPT = `Запусти AI-тренажер «Складний клієнт».

На старті запропонуй три рівні:
1. Олена — легкий
2. Максим — середній
3. Ігор — важкий

Після кожної моєї відповіді:
• оціни її від 0 до 10;
• назви застосовану техніку;
• дай короткий практичний фідбек;
• онови терпіння клієнта, готовність до угоди, середній бал і стрік;
• одразу продовж діалог у ролі клієнта.

Гра завершується закритою угодою або втраченим клієнтом. Не виходь із ролі тренажера без моєї команди.`;

const Feature = ({ icon: Icon, title, text }) => (
  <div className="rounded-3xl bg-[#141416] border border-white/10 p-4 flex gap-3">
    <div className="w-11 h-11 shrink-0 rounded-2xl bg-[#FFB800]/15 text-[#FFB800] flex items-center justify-center">
      <Icon size={20} strokeWidth={2.7} />
    </div>
    <div>
      <div className="text-sm font-black text-white">{title}</div>
      <div className="text-xs text-zinc-500 font-bold leading-relaxed mt-1">{text}</div>
    </div>
  </div>
);

export default function AITrainer() {
  const [copied, setCopied] = useState(false);
  const gptUrl = useMemo(() => DEFAULT_GPT_URL, []);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(START_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      const area = document.createElement("textarea");
      area.value = START_PROMPT;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const openTrainer = () => {
    window.open(gptUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="px-5 py-6 space-y-5" data-testid="ai-trainer-page">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#151516] border border-white/10 p-6">
        <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-[#FFB800]/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-16 w-44 h-44 rounded-full bg-[#00F0FF]/10 blur-3xl" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#FFB800]/15 border border-[#FFB800]/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#FFB800]">
            <Sparkles size={13} /> Навчання з AI
          </div>

          <div className="mt-5 w-16 h-16 rounded-[1.4rem] bg-[#FFB800] text-black flex items-center justify-center shadow-[0_0_36px_rgba(255,184,0,0.28)]">
            <Bot size={31} strokeWidth={2.8} />
          </div>

          <h1 className="font-display text-3xl text-white leading-tight mt-5">
            СКЛАДНИЙ<br />КЛІЄНТ
          </h1>
          <p className="text-sm text-zinc-400 font-bold leading-relaxed mt-3 max-w-sm">
            Практикуй роботу із запереченнями у живому діалозі. ChatGPT грає клієнта, оцінює твої відповіді та веде статистику тренування.
          </p>

          <button
            type="button"
            onClick={openTrainer}
            data-testid="open-ai-trainer"
            className="mt-6 w-full h-14 rounded-2xl bg-[#FFB800] text-black font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-[0_12px_35px_rgba(255,184,0,0.18)]"
          >
            Відкрити тренажер <ExternalLink size={18} strokeWidth={3} />
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3">
        <Feature icon={MessageSquareText} title="Реалістичний діалог" text="Три характери клієнтів і нові заперечення в кожному тренуванні." />
        <Feature icon={Gauge} title="Оцінювання 0–10" text="Техніка продажу, короткий фідбек і динаміка готовності до угоди." />
        <Feature icon={Flame} title="Стрік і прогрес" text="Середній бал, найкраща серія та підсумковий розбір розмови." />
      </div>

      <section className="rounded-[2rem] bg-[#141416] border border-white/10 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Перший запуск</div>
            <h2 className="font-display text-xl text-white mt-1">СКОПІЮЙ СЦЕНАРІЙ</h2>
          </div>
          <button
            type="button"
            onClick={copyPrompt}
            data-testid="copy-trainer-prompt"
            className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 text-zinc-300 flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Скопіювати сценарій"
          >
            {copied ? <Check size={19} className="text-[#00E6A8]" /> : <Copy size={19} />}
          </button>
        </div>
        <p className="text-xs text-zinc-500 font-bold leading-relaxed mt-3">
          Натисни кнопку копіювання, відкрий тренажер і встав текст у новий чат. Після цього обери рівень клієнта.
        </p>
        {copied && (
          <div className="mt-4 rounded-2xl bg-[#00E6A8]/10 border border-[#00E6A8]/25 px-4 py-3 text-xs font-black text-[#00E6A8]">
            Сценарій скопійовано
          </div>
        )}
      </section>

      <p className="px-2 text-[11px] text-zinc-600 font-bold leading-relaxed text-center">
        Працює через твій обліковий запис ChatGPT. Окремий API-ключ і поповнення API-балансу не потрібні.
      </p>
    </div>
  );
}
