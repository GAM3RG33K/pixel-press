import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Marquee } from "./marquee";

describe("Marquee", () => {
  it("renders as a plain clipped span when the content fits", () => {
    render(<Marquee title="ok.mp4" data-testid="m">ok.mp4</Marquee>);
    expect(screen.getByTestId("m").className).not.toContain("marquee-inner");
  });

  it("applies the title attribute for hover access", () => {
    render(<Marquee title="x.mp4" data-testid="m-title">x.mp4</Marquee>);
    expect(screen.getByTestId("m-title").getAttribute("title")).toBe("x.mp4");
  });

  it("renders children text", () => {
    render(<Marquee title="y.mp4" data-testid="m2">y.mp4</Marquee>);
    expect(screen.getByTestId("m2").textContent).toContain("y.mp4");
  });
});
