import { act } from "react";
import { createRoot } from "react-dom/client";
import SceneViewport from "./SceneViewport";

const session = (overrides = {}) => ({
  id: "scene-test",
  title: "Тестова сцена",
  image: "/scene.png",
  image_width: 2000,
  image_height: 1000,
  found_markers: [],
  ...overrides,
});

const pointer = (element, type, { x, y, pointerId = 1 }) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  act(() => element.dispatchEvent(event));
};

describe("SceneViewport panoramic interaction", () => {
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

  const render = (scene, onFind = jest.fn()) => {
    act(() => {
      root.render(
        <SceneViewport
          session={scene}
          hintMarker={null}
          missMarker={null}
          disabled={false}
          onFind={onFind}
        />,
      );
    });
    const viewport = container.querySelector(".hidden-scene-viewport");
    const svg = container.querySelector(".hidden-scene-svg");
    viewport.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 500,
      width: 400,
      height: 500,
    });
    return { onFind, svg, viewport };
  };

  test("drags a landscape scene horizontally at 100% without treating the drag as a find", () => {
    const { onFind, svg, viewport } = render(session());

    expect(viewport.classList.contains("is-panorama")).toBe(true);
    expect(container.querySelector('[data-testid="hidden-object-pan-hint"]')).not.toBeNull();
    expect(svg.style.transform).toContain("scale(1)");

    pointer(svg, "pointerdown", { x: 250, y: 250 });
    pointer(svg, "pointermove", { x: 130, y: 250 });

    expect(svg.style.transform).toContain("-120px");
    expect(svg.style.transform).toContain("scale(1)");

    pointer(svg, "pointerup", { x: 130, y: 250 });
    expect(onFind).not.toHaveBeenCalled();
  });

  test("keeps a portrait scene fixed at 100% and still maps an ordinary click through its SVG CTM", () => {
    const { onFind, svg, viewport } = render(session({
      id: "portrait-test",
      image_width: 600,
      image_height: 1000,
    }));

    expect(viewport.classList.contains("is-panorama")).toBe(false);
    expect(container.querySelector('[data-testid="hidden-object-pan-hint"]')).toBeNull();

    pointer(svg, "pointerdown", { x: 250, y: 250 });
    pointer(svg, "pointermove", { x: 130, y: 250 });
    expect(svg.style.transform).toContain("+ 0px");
    pointer(svg, "pointercancel", { x: 130, y: 250 });

    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform: () => ({ x: 0.25, y: 0.6 }),
    });
    pointer(svg, "pointerdown", { x: 100, y: 200 });
    pointer(svg, "pointerup", { x: 100, y: 200 });

    expect(onFind).toHaveBeenCalledWith({ x: 0.25, y: 0.6 });
  });

  test("brings an off-screen hint into view without recording a find", () => {
    const onFind = jest.fn();
    const scene = session();
    const { svg } = render(scene, onFind);
    act(() => root.render(
      <SceneViewport session={scene} hintMarker={{ x: 0.94, y: 0.5 }} missMarker={null} disabled={false} onFind={onFind} />,
    ));
    expect(svg.style.transform).toContain("-300px");
    expect(container.querySelector(".hidden-hint-marker")).not.toBeNull();
    expect(onFind).not.toHaveBeenCalled();
  });
});
