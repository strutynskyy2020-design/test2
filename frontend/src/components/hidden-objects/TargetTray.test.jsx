import { act } from "react";
import { createRoot } from "react-dom/client";
import TargetTray from "./TargetTray";

describe("picture clues", () => {
  let container;
  let root;
  const session = {
    targets: [
      { id: "key", label: "Латунний ключ", icon: "key", image: "/targets/key.png" },
      { id: "bird", label: "Пташка", icon: "bird", image: "/targets/bird.png" },
    ], found_ids: ["bird"], hints_total: 2, hints_used: 1,
  };
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });
  test("shows actual target pictures with accessible descriptions, in server order", () => {
    act(() => root.render(<TargetTray session={session} onHint={() => {}} />));
    const pictures = container.querySelectorAll("img");
    expect([...pictures].map((image) => image.getAttribute("src"))).toEqual(["/targets/key.png", "/targets/bird.png"]);
    expect(pictures[0].alt).toBe("Латунний ключ");
    expect(container.querySelector('[data-testid="hidden-object-target-bird"]').classList.contains("is-found")).toBe(true);
    expect(container.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("1");
  });
  test("keeps a readable clue if an image cannot load", () => {
    act(() => root.render(<TargetTray session={session} onHint={() => {}} />));
    act(() => container.querySelector("img").dispatchEvent(new Event("error")));
    const clue = container.querySelector('[data-testid="hidden-object-target-key"]');
    expect(clue.querySelector("img")).toBeNull();
    expect(clue.querySelector("svg")).not.toBeNull();
    expect(clue.textContent).toContain("Латунний ключ");
  });
  test("uses the generated WebP atlas and stable slots after targets are shuffled", () => {
    const targets = [
      { id: "large-brass-key", label: "Латунний ключ", icon: "key", image: "/old-key.webp" },
      { id: "blue-umbrella", label: "Синя парасоля", icon: "umbrella", image: "/old-umbrella.webp" },
    ];
    act(() => root.render(<TargetTray session={{ ...session, level_id: 1, targets, found_ids: [] }} onHint={() => {}} />));
    const pictures = [...container.querySelectorAll("img")];
    expect(pictures).toHaveLength(2);
    expect(pictures[0].getAttribute("src")).toMatch(/^\/hidden-objects\/icons-v7\/level-01\..+\.webp$/);
    expect(pictures[1].src).toBe(pictures[0].src);
    expect(pictures[0].style.top).toBe("-100%");
    expect(pictures[1].style.top).toBe("0%");
    expect(pictures[0].style.width).toBe("400%");
    expect(container.querySelectorAll(".hidden-target-sprite")).toHaveLength(2);
    act(() => pictures[0].dispatchEvent(new Event("error")));
    expect(container.querySelector('[data-testid="hidden-object-target-large-brass-key"] svg')).not.toBeNull();
  });
  test("does not permit hints after all targets are found", () => {
    act(() => root.render(<TargetTray session={{ ...session, found_ids: ["bird", "key"] }} onHint={() => {}} />));
    expect(container.querySelector("button").disabled).toBe(true);
  });
});
