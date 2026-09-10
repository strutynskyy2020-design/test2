import { act } from "react";
import { createRoot } from "react-dom/client";
import Feed from "./Feed";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn() }, extractError: (_error, fallback) => fallback }));
jest.mock("@/components/FeedSocial", () => ({ ev }) => <div data-testid={`social-${ev.id}`} />);
jest.mock("@/components/AvatarFrame", () => ({ alt }) => <span>{alt}</span>);

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

const base = { user_name: "Олена", avatar_initials: "ОЛ", avatar_color: "#FFB800", created_at: "2026-09-10T10:00:00Z" };
const events = [
  { ...base, id: "flight", kind: "game", game: "flappy", level: 3, title: "пройшов рівень у «Flappy Піксель»", subtitle: "Рівень 3" },
  { ...base, id: "drive", kind: "game", game: "pixel_drive", level: 2, title: "пройшов рівень у «Повний газ»", subtitle: "Рівень 2" },
  { ...base, id: "prize", kind: "purchase", title: "придбав приз", subtitle: "Чашка", amount: -300 },
  { ...base, id: "cube", kind: "cube", title: "кинув Щедрий Куб", amount: 40 },
];
const filter = key => act(() => container.querySelector(`[data-testid="feed-filter-${key}"]`).click());
const item = id => container.querySelector(`[data-testid="feed-item-${id}"]`);

test("both game completions show their own icons, level and social controls", async () => {
  api.get.mockResolvedValue({ data: { events } });
  await act(async () => root.render(<Feed />));
  expect(api.get).toHaveBeenCalledWith("/feed", { params: { limit: 60 } });
  expect(item("flight").textContent).toContain("Flappy Піксель");
  expect(item("flight").textContent).toContain("Рівень 3");
  expect(item("flight").querySelector(".lucide-plane")).not.toBeNull();
  expect(item("drive").textContent).toContain("Повний газ");
  expect(item("drive").textContent).toContain("Рівень 2");
  expect(item("drive").querySelector(".lucide-car")).not.toBeNull();
  expect(container.querySelector('[data-testid="social-flight"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="social-drive"]')).not.toBeNull();
  expect(item("flight").textContent).not.toContain("б.");
});

test("games, purchases and cube results remain separate feed filters", async () => {
  api.get.mockResolvedValue({ data: { events } });
  await act(async () => root.render(<Feed />));
  filter("game");
  expect(container.querySelectorAll('[data-testid^="feed-item-"]')).toHaveLength(2);
  expect(item("flight")).not.toBeNull();
  expect(item("drive")).not.toBeNull();
  expect(item("prize")).toBeNull();
  filter("purchase");
  expect(container.querySelectorAll('[data-testid^="feed-item-"]')).toHaveLength(1);
  expect(item("prize").textContent).toContain("Чашка");
  expect(item("cube")).toBeNull();
  filter("cube");
  expect(item("cube")).not.toBeNull();
  expect(item("prize")).toBeNull();
  filter("all");
  expect(container.querySelectorAll('[data-testid^="feed-item-"]')).toHaveLength(4);
});
