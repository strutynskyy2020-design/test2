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
  test("does not permit hints after all targets are found", () => {
    act(() => root.render(<TargetTray session={{ ...session, found_ids: ["bird", "key"] }} onHint={() => {}} />));
    expect(container.querySelector("button").disabled).toBe(true);
  });
});
