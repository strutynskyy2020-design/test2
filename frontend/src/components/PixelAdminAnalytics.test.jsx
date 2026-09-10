import { act } from "react";
import { createRoot } from "react-dom/client";
import PixelAdminAnalytics from "./PixelAdminAnalytics";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn() }, extractError: error => error.message }));

function fixture(started = 3) {
  return {
    generated_at: "2026-09-10T12:00:00Z", attempt_period_days: 7,
    story: {started, in_progress: 2, not_started: 4, completed: 1, completion_rate: 33.3, average_chapters: 8,
      chapters_total: 24, required_levels: 147, unknown_ending: 0, contact: {started: 0, completed: 0},
      endings: [{id: "our_home", title: "Наш дім", players: 1, share: 100}, {id: "separate_doors", title: "Окремі двері", players: 0, share: 0}],
      chapters: [{id: 1, title: "Лист за шафою", required_levels: 3, started, current: 2, completed: 1, completion_rate: 33.3,
        choices: [{id: "letter", title: "Знайдений лист", total: 1, options: [{id: "private", label: "Прочитаю сам", count: 1, share: 100}]}]}]},
    games: [["bonus_match", "Bonus Match"], ["hidden_objects", "VPDK Детектив"], ["flappy", "Flappy Піксель"], ["pixel_drive", "Повний газ"]].map(([id, title]) => ({
      id, title, players: 2, completed_players: 1, levels_total: 2, required_story_levels: 2, unique_clears: 3, average_levels: 1.5,
      active_players: 2, recent: {attempts: 9, wins: 5, losses: 2, unfinished: 2, success_rate: 71.4},
      levels: [{id: 1, title: `${title} — перший рівень`, players_completed: 2, attempts: 7, wins: 4, losses: 1, success_rate: 80}]})),
  };
}

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });
const render = async props => { await act(async () => { root.render(<PixelAdminAnalytics {...props} />); }); };
const click = async text => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent.includes(text)).click(); }); };

test("shows chapter progression, endings and saved choice distribution", async () => {
  api.get.mockResolvedValue({data: fixture()});
  await render({});
  expect(api.get).toHaveBeenCalledWith("/admin/pixel-analytics");
  expect(container.textContent).toContain("Світлиця · усі 24 розділи");
  expect(container.textContent).toContain("147 різних рівнів");
  expect(container.textContent).toContain("Наш дім");
  expect(container.textContent).toContain("Окремі двері");
  expect(container.querySelector("details").textContent).toContain("Прочитаю сам");
  expect(container.querySelector("table").textContent).toContain("Лист за шафою");
});

test("all four games have distinct level statistics with the seven-day definition", async () => {
  api.get.mockResolvedValue({data: fixture()});
  await render({});
  await click("Чотири мінігри");
  for (const game of fixture().games) {
    await click(game.title);
    expect(container.querySelector("table").textContent).toContain(`${game.title} — перший рівень`);
  }
  expect(container.textContent).toContain("Різних проходжень");
  expect(container.textContent).toContain("Спроби, розпочаті за останні 7 діб");
  expect(container.textContent).toContain("Без завершеного результату: 2");
  expect(container.textContent).toContain("Вони не входять у відсоток успішності");
});

test("team change ignores a late response from the previous team", async () => {
  let first;
  api.get.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }));
  await render({teamFilter: "old"});
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  const data = fixture(); data.story.chapters[0].title = "Обрана команда";
  api.get.mockResolvedValueOnce({data});
  await render({teamFilter: "new & team"});
  expect(api.get).toHaveBeenLastCalledWith("/admin/pixel-analytics?team_id=new%20%26%20team");
  await act(async () => { first({data: fixture()}); });
  expect(container.querySelector("table").textContent).toContain("Обрана команда");
});

test("error can be retried and empty statistics use a dash instead of fake percentages", async () => {
  api.get.mockRejectedValueOnce(new Error("Сервіс недоступний"));
  await render({});
  expect(container.querySelector('[role="alert"]').textContent).toContain("Сервіс недоступний");
  const data = fixture(0);
  data.story.completion_rate = null;
  data.story.chapters[0].completion_rate = null;
  api.get.mockResolvedValueOnce({data});
  await click("Спробувати ще раз");
  expect(container.textContent).toContain("ще немає проходжень");
  expect(container.querySelector("table").textContent).toContain("—");
  expect(container.textContent).not.toContain("NaN");
});

test("refresh keeps the current team scope", async () => {
  api.get.mockResolvedValue({data: fixture()});
  await render({teamFilter: "one"});
  await click("Оновити");
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.get).toHaveBeenLastCalledWith("/admin/pixel-analytics?team_id=one");
});
