import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupPage from "./page";
import { register } from "@/lib/api";
import { mockLogin } from "@/lib/mock";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api", () => ({
  register: vi.fn(),
  // GoogleAuthButton (rendered on this page) imports setToken directly.
  setToken: vi.fn(),
}));

// Must satisfy the shared password policy (@brandpilot/core's PASSWORD_RULES):
// uppercase, lowercase, a digit, and a special character, min 8 chars.
const STRONG_PASSWORD = "Correct-Horse-1!";
const WEAK_PASSWORD = "password";

beforeEach(() => {
  push.mockReset();
  vi.mocked(register).mockReset();
  vi.mocked(register).mockResolvedValue(mockLogin);
});

async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
) {
  await user.type(screen.getByLabelText("Business name"), "Lumina Skin");
  await user.type(screen.getByLabelText("Work email"), "ava@luminaskin.co");
  await user.type(screen.getByLabelText("Password"), password);
}

describe("SignupPage", () => {
  it("disables submit for a weak password and the checklist reflects the failing rules", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await fillRequiredFields(user, WEAK_PASSWORD);

    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeDisabled();

    // "password" is 8 lowercase letters: length + lowercase are satisfied,
    // uppercase/number/special are not.
    expect(
      screen.getByText("At least 8 characters").closest("li"),
    ).toHaveTextContent("✓");
    expect(
      screen.getByText("A lowercase letter").closest("li"),
    ).toHaveTextContent("✓");
    expect(
      screen.getByText("An uppercase letter").closest("li"),
    ).toHaveTextContent("○");
    expect(screen.getByText("A number").closest("li")).toHaveTextContent("○");
    expect(
      screen.getByText("A special character").closest("li"),
    ).toHaveTextContent("○");

    expect(register).not.toHaveBeenCalled();
  });

  it("enables submit once the password satisfies every rule, and registers on click", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await fillRequiredFields(user, STRONG_PASSWORD);

    const submit = screen.getByRole("button", { name: "Create account" });
    expect(submit).not.toBeDisabled();
    for (const label of [
      "At least 8 characters",
      "An uppercase letter",
      "A lowercase letter",
      "A number",
      "A special character",
    ]) {
      expect(screen.getByText(label).closest("li")).toHaveTextContent("✓");
    }

    await user.click(submit);

    expect(register).toHaveBeenCalledWith({
      orgName: "Lumina Skin",
      email: "ava@luminaskin.co",
      password: STRONG_PASSWORD,
    });
    expect(push).toHaveBeenCalledWith("/onboarding");
  });

  it("keeps submit disabled while the password is empty", () => {
    render(<SignupPage />);

    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeDisabled();
  });

  it("renders a Continue with Google button above the email form", () => {
    render(<SignupPage />);

    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
  });
});
