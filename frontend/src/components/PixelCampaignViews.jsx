import { ArrowRight, Check, Feather, Gamepad2, Plane, Car, Search, Sparkles, DoorOpen } from "lucide-react";

export const PIXEL_GAMES = [
  { id: "bonus_match", title: "Bonus Match", subtitle: "Збирай комбінації", description: "Поєднуй фішки й виконуй цілі рівня. Пір’їнки повернуться у вашу історію.", route: "/games/bonus-match?from=pixel", Icon: Sparkles, color: "match" },
  { id: "hidden_objects", title: "VPDK Детектив", subtitle: "Помічай приховане", description: "Шукай предмети й завершуй справи. Кожна підтверджена перемога може наблизити наступну знахідку.", route: "/games/hidden-objects?from=pixel", Icon: Search, color: "detective" },
  { id: "flappy", title: "Flappy Піксель", subtitle: "Відчуй ритм польоту", description: "Один дотик — один змах. Дістанься кінця польоту між перешкодами.", route: "/games/flappy-pixel?from=pixel", Icon: Plane, color: "flappy" },
  { id: "pixel_drive", title: "Повний газ", subtitle: "Знайди свій шлях", description: "Газ, гальмо й дорога попереду. Досягни фінішу; деталі для гаража зберігаються окремо від пір’їнок.", route: "/games/pixel-drive?from=pixel", Icon: Car, color: "drive" },
];
export const GAME_ROUTES = Object.fromEntries(PIXEL_GAMES.map(game => [game.id, game.route]));

export function PixelMiniGames({ campaign, onPlay, compact = false }) {
  const task = campaign.step.kind === "game" ? campaign.step : null;
  const eligible = task ? task.games || [task.game] : [];
  return <div className={compact ? "pixel-mini-preview" : "pixel-games-hub"}>
    {!compact && <><div className="pixel-section-intro"><span className="pixel-eyebrow">ЧОТИРИ СПОСОБИ ПРОДОВЖИТИ</span><h2>Маленькі пригоди</h2><p>Грай, отримуй пір’їнки й повертайся до історії. Програш не псує стосунків із Пікселем.</p></div>
      {task && <div className="pixel-current-mission"><Gamepad2 size={23} /><div><strong>{task.title}</strong><p>{campaign.progress} / {task.count} нових рівнів · потрібна саме позначена гра.</p></div></div>}</>}
    {!compact && campaign.game_requirements && <div className="pixel-story-requirements" aria-label="Рівні для завершення сюжету">
      <h3>Шлях до фіналу · {campaign.game_requirements.completed} / {campaign.game_requirements.total} рівнів</h3>
      <p>24 розділи. У кожної гри є обов’язкові завдання.</p>
      <ul>{PIXEL_GAMES.map(game => {
        const progress = campaign.game_requirements.games.find(item => item.id === game.id);
        return progress && <li key={game.id}><strong>{game.title}</strong><span>{progress.completed} / {progress.total}{progress.banked > 0 ? ` · у запасі ${progress.banked}` : ""}</span></li>;
      })}</ul>
      <p>Після фіналу «Окремі двері» доступна необов’язкова зустріч: ще {campaign.game_requirements.postlude} нові рівні Bonus Match.</p>
    </div>}
    <div className="pixel-mini-grid">{PIXEL_GAMES.map(({ id, title, subtitle, description, route, Icon, color }) => <button type="button" key={id} className={`pixel-mini-card is-${color} ${eligible.includes(id) ? "is-quest" : ""}`} onClick={() => onPlay(route)}>
      <span className="pixel-mini-art" aria-hidden="true"><Icon size={compact ? 24 : 42} /></span><span className="pixel-mini-copy"><small>{eligible.includes(id) ? "СЮЖЕТНЕ ЗАВДАННЯ" : "МІНІГРА"}</small><strong>{title}</strong><span>{compact ? subtitle : description}</span>{!compact && <em><Feather size={14} />{eligible.includes(id) ? "10 пір’їнок за новий рівень" : "10 пір’їнок за новий рівень"}</em>}</span><ArrowRight size={17} />
    </button>)}</div>
    {!compact && <p className="pixel-games-note">Кожен рівень дає 10 пір’їнок і одне сюжетне зарахування лише один раз. Повторні проходження не додають прогресу або пір’їнок. Рівні, пройдені наперед, зберігаються для майбутніх завдань своєї гри. Навчальні заїзди й локальний режим без акаунта не дають сюжетних нагород.</p>}
  </div>;
}

export function PixelEnding({ campaign, busy, onContact, onJournal }) {
  const ending = campaign.ending;
  if (!ending) return null;
  const contactComplete = campaign.contact?.step >= 3;
  return <div className={`pixel-ending is-${ending.id}`}>
    <span className="pixel-eyebrow">ІСТОРІЮ СВІТЛИЦІ ЗАВЕРШЕНО · 24 / 24</span>
    <div className="pixel-ending-emblem"><DoorOpen size={35} /></div><h2>{ending.title}</h2><p className="pixel-ending-subtitle">{ending.subtitle}</p>
    <blockquote>{ending.lines[0]}</blockquote>
    <div className="pixel-ending-facts"><article><Check size={19} /><div><h3>Що сталося зі Світлицею</h3><p>{ending.world}</p><p>{ending.public_record}</p><p>Ремонт підтверджено, спільний фонд повернуто. Повний звіт Мирона збережено в архіві Ніни.</p></div></article><article><DoorOpen size={19} /><div><h3>Що залишилося між вами</h3><p>{ending.reason}</p><p>{ending.present ? "Піксель залишається у вашому домі." : "Піксель живе в Ніни. У твоїй кімнаті його більше немає; мініігри й облаштування доступні."}</p></div></article></div>
    {!ending.present && !campaign.contact && <button type="button" className="pixel-primary" disabled={busy} onClick={onContact}>Передати лист через Ніну<ArrowRight size={16} /></button>}
    {contactComplete && <p className="pixel-contact-complete">Зустріч відбулася. Ви відновили обережний контакт; Піксель продовжує жити в Ніни. Цей крок записано окремо й не переписує фінал.</p>}
    <button type="button" className="pixel-text-button" onClick={onJournal}>Перечитати ваш шлях<ArrowRight size={15} /></button>
  </div>;
}
