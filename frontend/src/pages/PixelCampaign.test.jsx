import { act } from "react";
import { createRoot } from "react-dom/client";
import { PixelCampaign, PixelDialogue } from "./PixelCampaign";
import { PixelGameReward } from "@/components/PixelGameBridge";
import { PixelMiniGames, PixelEnding } from "@/components/PixelCampaignViews";
import api from "@/lib/api";

jest.mock("react-router-dom", () => ({ useLocation: () => ({ search: "" }), useNavigate: () => jest.fn() }), { virtual: true });
jest.mock("./PetCatSprite", () => () => <div data-testid="animated-cat" />);
jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() }, extractError: (e, fallback) => e.message || fallback }));

const state = () => ({
  revision: 4, step: { id: "letter", kind: "dialogue", chapter: 1, title: "Лист за шафою", lines: ["Знайшли лист.", "Почитаємо разом?"], choices: [{ id: "together", label: "Так, разом." }, { id: "private", label: "Спершу прочитаю сам." }] },
  line: 1, outcome: null, progress: 0, wallet: { feathers: 20, gold: 0 }, relationship: { key: "curious", label: "Придивляється", description: "Початок", reason: "Ви знайомитесь" },
  memories: [], promise: null, placement: "window", owned: [], equipped: {}, completed: [], discoveries: [], journal: [], chapters: [{ id: 1, title: "Лист за шафою", summary: "Перший розділ" }], catalog: [],
});
let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });
const button = text => [...container.querySelectorAll("button")].find(b => b.textContent.includes(text));
const render = async element => { await act(async () => { root.render(element); }); };

test("all four mini-games retain their Pixel origin and only the required game is marked as a story task", async () => {
  const onPlay = jest.fn();
  await render(<PixelMiniGames campaign={{...state(), step:{kind:"game", game:"flappy", games:["flappy"], count:2, title:"Доставка"}}} onPlay={onPlay} />);
  expect(container.querySelectorAll(".pixel-mini-card")).toHaveLength(4);
  expect(container.querySelectorAll(".is-quest")).toHaveLength(1);
  act(() => button("Flappy Піксель").click());
  act(() => button("Повний газ").click());
  expect(onPlay.mock.calls).toEqual([["/games/flappy-pixel?from=pixel"],["/games/pixel-drive?from=pixel"]]);
});

test("game menu shows server-owned totals, saved clears and the optional epilogue", async () => {
  await render(<PixelMiniGames campaign={{...state(), game_requirements:{total:147, completed:8, postlude:2,
    games:[{id:"bonus_match",total:79,completed:5,banked:0}, {id:"hidden_objects",total:52,completed:2,banked:0},
      {id:"flappy",total:12,completed:1,banked:3}, {id:"pixel_drive",total:4,completed:0,banked:0}]}}} onPlay={jest.fn()} />);
  const text = container.querySelector(".pixel-story-requirements").textContent;
  expect(text).toContain("8 / 147");
  expect(text).toContain("5 / 79");
  expect(text).toContain("2 / 52");
  expect(text).toContain("1 / 12 · у запасі 3");
  expect(text).toContain("0 / 4");
  expect(text).toContain("ще 2 нові рівні Bonus Match");
  expect(container.textContent).toContain("Повторні проходження не додають прогресу або пір’їнок");
});

test("replay result explains that neither feathers nor story progress are awarded", async () => {
  api.post.mockResolvedValue({data:{reward:{feathers:0,quest:false,first_clear:false}}});
  await render(<PixelGameReward enabled game="flappy" sessionId="repeat" onReturn={jest.fn()} />);
  expect(container.textContent).toContain("Повтор не додає пір’їнок або сюжетного прогресу");
  expect(container.textContent).not.toContain("Сюжетне проходження зараховано");
});

test("the completed negative ending removes the room cat and keeps games available", async () => {
  api.get.mockResolvedValue({data:{...state(), step:{id:"end",kind:"end",chapter:24,title:"Окремі двері"}, cat_present:false,
    ending:{id:"separate_doors",present:false,title:"Окремі двері",lines:["Я переїжджаю до Ніни."]}}});
  await render(<PixelCampaign />);
  expect(container.querySelector('[data-testid="animated-cat"]')).toBeNull();
  expect(button("Flappy Піксель")).toBeDefined();
  expect(button("Повний газ")).toBeDefined();
});

test("post-ending contact is a deliberate separate action, with no auto-return", async () => {
  const onContact=jest.fn();
  const data={...state(),ending:{id:"separate_doors",present:false,title:"Окремі двері",lines:["Я переїжджаю до Ніни."]},contact:null};
  await render(<PixelEnding campaign={data} onContact={onContact} onJournal={jest.fn()} />);
  expect(onContact).not.toHaveBeenCalled();
  act(()=>button("Передати лист").click());
  expect(onContact).toHaveBeenCalledTimes(1);
  await render(<PixelEnding campaign={{...data,contact:{step:3}}} onContact={onContact} onJournal={jest.fn()} />);
  expect(button("Передати лист")).toBeUndefined();
  expect(container.textContent).toContain("продовжує жити в Ніни");
});

test("Nina can deliver evidence without displaying Pixel's portrait", async () => {
  const data={...state(),step:{...state().step,speaker:"Ніна"}};
  await render(<PixelDialogue campaign={data} onAction={jest.fn()} onClose={jest.fn()} />);
  expect(container.querySelector('.pixel-dialogue-portrait')).toBeNull();
  expect(container.querySelector('.pixel-dialogue-heading').textContent).toContain("НІНА");
});

test("a story choice has explicit buttons and cannot be skipped or auto-advanced", async () => {
  const onAction = jest.fn();
  await render(<PixelDialogue campaign={state()} onAction={onAction} onClose={() => {}} busy={false} />);
  expect(button("До кінця")).toBeUndefined();
  expect(button("Далі")).toBeUndefined();
  expect(document.activeElement.textContent).toBe("Почитаємо разом?");
  act(() => button("Спершу").click());
  expect(onAction).toHaveBeenCalledWith("choose", { choice_id: "private" });
});

test("skipping exposition is a separate action and does not choose a response", async () => {
  const onAction = jest.fn();
  await render(<PixelDialogue campaign={{ ...state(), line: 0 }} onAction={onAction} onClose={() => {}} busy={false} />);
  act(() => button("До кінця").click());
  expect(onAction.mock.calls).toEqual([["skip"]]);
});

test("while saving, choices are disabled; saved outcome is displayed without repeat choices", async () => {
  await render(<PixelDialogue campaign={state()} onAction={jest.fn()} onClose={() => {}} busy />);
  expect(button("Так, разом.").disabled).toBe(true);
  await render(<PixelDialogue campaign={{ ...state(), outcome: "Я запам’ятаю." }} onAction={jest.fn()} onClose={() => {}} busy={false} />);
  expect(button("Так, разом.")).toBeUndefined();
  expect(container.textContent).toContain("Рішення збережено");
  expect(document.activeElement.textContent).toBe("Я запам’ятаю.");
});

test("room restores server choice after reload and never calls the legacy care API", async () => {
  api.get.mockResolvedValue({ data: { ...state(), outcome: "Читаємо разом.", journal: [{ kind: "choice", title: "Лист", text: "Знайшли", choice: "Разом", response: "Читаємо" }] } });
  await render(<PixelCampaign />);
  expect(container.textContent).toContain("Читаємо разом.");
  await act(async () => button("Щоденник").click());
  expect(container.textContent).toContain("Сторінки щоденника");
  expect(container.querySelector(".pixel-choices")).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  expect(api.get.mock.calls.every(([path]) => path === "/pet/campaign")).toBe(true);
});

test("rapid double click sends one choice with the current revision; failure leaves choice visible", async () => {
  api.get.mockResolvedValue({ data: state() });
  let reject;
  api.post.mockReturnValue(new Promise((resolve, fail) => { reject = fail; }));
  await render(<PixelCampaign />);
  act(() => { button("Так, разом.").click(); button("Так, разом.").click(); });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post.mock.calls[0][1]).toMatchObject({ kind: "choose", step_id: "letter", revision: 4, choice_id: "together" });
  await act(async () => reject(new Error("З’єднання перервано")));
  expect(container.querySelector('[role="alert"]').textContent).toContain("З’єднання перервано");
  expect(button("Так, разом.").disabled).toBe(false);
});

test("game result survives an unavailable feather service and offers return/retry", async () => {
  api.post.mockRejectedValue(new Error("offline"));
  const onReturn = jest.fn();
  await render(<PixelGameReward enabled game="hidden_objects" sessionId="verified-run" onReturn={onReturn} />);
  expect(api.post.mock.calls[0]).toEqual(["/pet/campaign/claim", { game: "hidden_objects", session_id: "verified-run" }]);
  expect(container.textContent).toContain("Перемога збережена");
  expect(button("Повторити перевірку")).toBeDefined();
  act(() => button("До Пікселя").click());
  expect(onReturn).toHaveBeenCalledTimes(1);
});

test("standalone or mock result never requests story currency", async () => {
  await render(<PixelGameReward enabled={false} game="bonus_match" sessionId="mock-run" />);
  expect(api.post).not.toHaveBeenCalled();
});
