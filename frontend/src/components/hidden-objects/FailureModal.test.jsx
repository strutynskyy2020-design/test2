import { act } from "react";
import { createRoot } from "react-dom/client";
import FailureModal from "./FailureModal";

const failedSession = {
  id: "failed-session",
  title: "Зниклі креслення",
  status: "failed",
  mistake_limit: 5,
  mistakes: 5,
  mistakes_remaining: 0,
  found_ids: ["one", "two"],
  targets: [{ id: "one" }, { id: "two" }, { id: "three" }],
};

describe("FailureModal", () => {
  let container;
  let root;

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

  const renderModal = (props = {}) => {
    const onReplay = jest.fn();
    const onClose = jest.fn();
    act(() => {
      root.render(<FailureModal session={failedSession} open busy={false} onReplay={onReplay} onClose={onClose} {...props} />);
    });
    return { onReplay, onClose };
  };

  test("announces the loss, shows progress, focuses retry, and exposes both recovery actions", () => {
    const { onReplay, onClose } = renderModal();
    const dialog = container.querySelector('[role="alertdialog"]');
    const buttons = [...container.querySelectorAll("button")];

    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Ліміт промахів вичерпано");
    expect(dialog.textContent).toContain("5/5");
    expect(dialog.textContent).toContain("2/3");
    expect(document.activeElement).toBe(buttons[0]);

    act(() => buttons[0].click());
    act(() => buttons[1].click());
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("returns to the case list on Escape", () => {
    const { onClose } = renderModal();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

