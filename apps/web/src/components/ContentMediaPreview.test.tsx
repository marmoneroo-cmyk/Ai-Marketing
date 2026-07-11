import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentMediaPreview } from "./ContentMediaPreview";
import type { ContentMedia } from "@/lib/types";

const imageMedia: ContentMedia = {
  url: "data:image/svg+xml,fake-image",
  kind: "image",
  alt: "Generated carousel cover",
  aspect: "square",
};

describe("ContentMediaPreview", () => {
  it("renders the generated image with its alt text and source", () => {
    render(<ContentMediaPreview media={imageMedia} />);
    const img = screen.getByRole("img", { name: "Generated carousel cover" });
    expect(img).toHaveAttribute("src", "data:image/svg+xml,fake-image");
  });

  it("adds a play affordance for a video/reel, keeping the poster image", () => {
    const { container } = render(
      <ContentMediaPreview
        media={{ ...imageMedia, kind: "video", alt: "Generated reel cover", aspect: "portrait" }}
      />,
    );
    expect(screen.getByRole("img", { name: "Generated reel cover" })).toBeInTheDocument();
    // The play overlay renders a decorative <svg> that image thumbnails omit.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows no play affordance for a still image", () => {
    const { container } = render(<ContentMediaPreview media={imageMedia} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
