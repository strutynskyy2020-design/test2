import { useEffect, useState } from "react";
import { BookOpen, Flag, Gamepad2, RefreshCw, Users } from "lucide-react";
import api, { extractError } from "@/lib/api";

const number = value => Number(value || 0).toLocaleString("uk-UA");
const rate = value => value == null ? "—" : `${Number(value).toLocaleString("uk-UA")}%`;
const panel = "rounded-2xl border border-white/10 bg-[#1A1A1E] p-4 sm:p-5";
const heading = "font-black text-white text-sm";

function Metric({ label, value, detail }) {
  return <div className={panel}><div className="text-xs text-zinc-400">{label}</div><div className="mt-2 font-display text-2xl text-[#FFB800]">{value}</div>{detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}</div>;
}

function DataTable({ label, headers, children }) {
  return <div className="overflow-x-auto rounded-xl border border-white/10" role="region" aria-label={label} tabIndex={0}>
    <table className="w-full min-w-[660px] text-left text-xs"><caption className="sr-only">{label}</caption>
      <thead className="bg-white/5 text-zinc-400"><tr>{headers.map(text => <th scope="col" key={text} className="px-3 py-3 font-bold">{text}</th>)}</tr></thead>
      <tbody className="divide-y divide-white/5 text-zinc-200">{children}</tbody>
    </table>
  </div>;
}

function StoryStatistics({ story }) {
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric label="Відкрили історію" value={number(story.started)} detail={`${number(story.not_started)} ще не почали`} />
      <Metric label="Проходять зараз" value={number(story.in_progress)} />
      <Metric label="Завершили сюжет" value={number(story.completed)} detail={`${rate(story.completion_rate)} від тих, хто почав`} />
      <Metric label="Розділів у середньому" value={number(story.average_chapters)} detail={`із ${story.chapters_total} розділів`} />
    </div>
    {story.started === 0 && <p className={`${panel} text-sm text-zinc-400`}>У цій вибірці ще немає проходжень історії Пікселя.</p>}
    <section className={panel} aria-label="Фінали історії">
      <h2 className={`${heading} flex items-center gap-2`}><Flag size={17} />Чим закінчилася ваша історія</h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">Частка кожного фіналу серед гравців, які завершили сюжет. Повторний перегляд діалогу не створює нового проходження.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{story.endings.map(ending => <article key={ending.id} className="rounded-xl bg-black/20 p-4">
        <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-bold text-white">{ending.title}</h3><strong className="text-[#B78CFF]">{number(ending.players)}</strong></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-[#B78CFF]" style={{ width: `${ending.share || 0}%` }} /></div>
        <p className="mt-2 text-xs text-zinc-400">{rate(ending.share)} завершених історій</p>
      </article>)}</div>
      {story.unknown_ending > 0 && <p className="mt-3 text-xs text-amber-300">Без записаного фіналу у старому збереженні: {number(story.unknown_ending)}.</p>}
      <p className="mt-4 text-xs leading-relaxed text-zinc-400">Зустріч після «Окремих дверей»: почали {number(story.contact.started)}, завершили {number(story.contact.completed)}. Вона обліковується окремо від основного фіналу.</p>
    </section>
    <section className={`${panel} space-y-4`} aria-label="Проходження розділів">
      <div><h2 className={heading}>Світлиця · усі {story.chapters_total} розділи</h2><p className="mt-2 text-xs leading-relaxed text-zinc-400">У сюжеті {story.required_levels} різних рівнів мініігор. «Зараз» — гравці, чиє збереження залишилося в цьому розділі. Відсоток завершення розраховано від тих, хто до нього дійшов.</p></div>
      <DataTable label="Статистика кожного розділу" headers={["Розділ", "Рівнів ігор", "Почали", "Зараз", "Завершили", "Завершення"]}>
        {story.chapters.map(chapter => <tr key={chapter.id}>
          <th scope="row" className="max-w-[240px] px-3 py-3 font-medium"><span className="mr-2 text-zinc-500">{chapter.id}.</span>{chapter.title}</th>
          <td className="px-3 py-3">{chapter.required_levels}</td><td className="px-3 py-3">{number(chapter.started)}</td>
          <td className="px-3 py-3 text-[#00F0FF]">{number(chapter.current)}</td><td className="px-3 py-3">{number(chapter.completed)}</td>
          <td className="px-3 py-3 text-[#39FF14]">{rate(chapter.completion_rate)}</td>
        </tr>)}
      </DataTable>
    </section>
    <section className={`${panel} space-y-3`} aria-label="Рішення в сюжеті">
      <h2 className={heading}>Які рішення обирають гравці</h2>
      <p className="text-xs text-zinc-400">Один збережений вибір на гравця в кожній сцені. Відсотки рахуються серед відповідей у цій сцені.</p>
      {story.chapters.filter(chapter => chapter.choices.length).map(chapter => <details key={chapter.id} className="rounded-xl border border-white/10 p-3">
        <summary className="cursor-pointer text-sm font-bold text-zinc-200">{chapter.id}. {chapter.title}</summary>
        <div className="mt-4 space-y-5">{chapter.choices.map(choice => <div key={choice.id}>
          <h3 className="text-xs font-bold text-[#FFB800]">{choice.title} · {number(choice.total)} відповідей</h3>
          <ul className="mt-2 space-y-2">{choice.options.map(option => <li key={option.id} className="flex items-start justify-between gap-4 rounded-lg bg-black/20 p-3 text-xs">
            <span className="leading-relaxed text-zinc-300">{option.label}</span><span className="shrink-0 text-right text-white">{number(option.count)}<small className="block text-zinc-500">{rate(option.share)}</small></span>
          </li>)}</ul>
        </div>)}</div>
      </details>)}
    </section>
  </div>;
}

function GameStatistics({ games, days }) {
  const [selected, setSelected] = useState("bonus_match");
  const game = games.find(row => row.id === selected) || games[0];
  if (!game) return null;
  return <div className="space-y-4">
    <p className="text-sm leading-relaxed text-zinc-400">Прогрес — за поточними збереженнями й каталогами. Кожна пара «гравець + рівень» рахується один раз. Спроби та перемоги в спробах — за останні {days} діб, включно з повторами.</p>
    <div className="grid gap-3 sm:grid-cols-2">{games.map(row => <button type="button" key={row.id} aria-pressed={game.id === row.id} onClick={() => setSelected(row.id)}
      className={`rounded-2xl border p-4 text-left transition-colors ${game.id === row.id ? "border-[#FFB800] bg-[#FFB800]/10" : "border-white/10 bg-[#1A1A1E] hover:border-white/30"}`}>
      <span className="flex items-center justify-between gap-2 font-bold text-white"><span>{row.title}</span><Gamepad2 size={18} className="shrink-0 text-[#FFB800]" /></span>
      <span className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400"><span>Гравців <strong className="block text-lg text-white">{number(row.players)}</strong></span><span>Гру завершили <strong className="block text-lg text-[#39FF14]">{number(row.completed_players)}</strong></span></span>
      <span className="mt-3 block text-xs text-zinc-500">{row.levels_total} рівнів у каталозі · {row.required_story_levels} потрібно для сюжету</span>
    </button>)}</div>
    <section className={`${panel} space-y-4`} aria-label={`Статистика ${game.title}`}>
      <h2 className={heading}>{game.title} · прогрес</h2>
      <div className="grid grid-cols-2 gap-3"><Metric label="Різних проходжень" value={number(game.unique_clears)} detail="Сума пройдених рівнів усіх гравців" /><Metric label="Рівнів на гравця" value={number(game.average_levels)} /></div>
      <h3 className={heading}>Спроби, розпочаті за останні {days} діб</h3>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Гравців за період" value={number(game.active_players)} /><Metric label="Спроб" value={number(game.recent.attempts)} />
        <Metric label="Перемог у спробах" value={number(game.recent.wins)} /><Metric label="Успішність" value={rate(game.recent.success_rate)} detail="Серед перемог і поразок" />
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">Поразок: {number(game.recent.losses)}. Без завершеного результату: {number(game.recent.unfinished)} — зокрема відкриті, замінені або прострочені сесії. Вони не входять у відсоток успішності. Локальна гра без акаунта не враховується.</p>
      <DataTable label={`Рівні ${game.title}`} headers={["Рівень", "Пройшли гравців", `Спроб · ${days} д.`, "Перемог", "Поразок", "Успішність"]}>
        {game.levels.map(level => <tr key={level.id}>
          <th scope="row" className="max-w-[240px] px-3 py-3 font-medium"><span className="mr-2 text-zinc-500">{level.id}.</span>{level.title}</th>
          <td className="px-3 py-3 text-[#39FF14]">{number(level.players_completed)}</td><td className="px-3 py-3">{number(level.attempts)}</td>
          <td className="px-3 py-3">{number(level.wins)}</td><td className="px-3 py-3">{number(level.losses)}</td><td className="px-3 py-3">{rate(level.success_rate)}</td>
        </tr>)}
      </DataTable>
    </section>
  </div>;
}

export default function PixelAdminAnalytics({ teamFilter = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [section, setSection] = useState("story");
  useEffect(() => {
    let active = true;
    setData(null); setError(null);
    const query = teamFilter ? `?team_id=${encodeURIComponent(teamFilter)}` : "";
    api.get(`/admin/pixel-analytics${query}`).then(({ data: result }) => {
      if (active) setData(result);
    }).catch(reason => { if (active) setError(extractError(reason, "Не вдалося завантажити статистику")); });
    return () => { active = false; };
  }, [teamFilter, retry]);
  if (error) return <div className={`${panel} space-y-3`} role="alert"><p className="text-sm text-red-300">{error}</p><button type="button" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-white" onClick={() => setRetry(value => value + 1)}>Спробувати ще раз</button></div>;
  if (!data) return <p role="status" className="py-10 text-center text-sm text-zinc-400">Завантаження статистики Пікселя…</p>;
  return <div className="space-y-4" data-testid="pixel-admin-analytics">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" aria-label="Розділи статистики">
        {[{ id: "story", label: "Сюжет Пікселя", Icon: BookOpen }, { id: "games", label: "Чотири мінігри", Icon: Gamepad2 }].map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)} className={`flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-bold ${section === id ? "bg-[#FFB800] text-black" : "bg-white/5 text-zinc-300"}`}><Icon size={16} />{label}</button>)}
      </div>
      <button type="button" onClick={() => setRetry(value => value + 1)} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-3 text-xs font-bold text-zinc-300"><RefreshCw size={15} />Оновити</button>
    </div>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-500"><Users size={15} className="mt-0.5 shrink-0" />Працівники й редактори вибраної команди. Адміністративні акаунти не враховуються. Оновлено: {new Date(data.generated_at).toLocaleString("uk-UA")}.</p>
    {section === "story" ? <StoryStatistics story={data.story} /> : <GameStatistics games={data.games} days={data.attempt_period_days} />}
  </div>;
}
