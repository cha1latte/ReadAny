// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./opds-component-test-setup";
import { OpdsCatalogFormDialog } from "./OpdsCatalogFormDialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("OpdsCatalogFormDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes a localized, keyboard-complete Basic-auth add flow", async () => {
    const addCatalog = vi.fn(async (_input: unknown) => ({ id: "added" }));
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <OpdsCatalogFormDialog
        open
        store={{ addCatalog } as never}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByRole("dialog", { name: "library.opds.form.addTitle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "library.opds.close" })).toBeTruthy();
    const anonymous = screen.getByRole("radio", { name: "library.opds.form.anonymous" });
    anonymous.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      (screen.getByRole("radio", { name: "library.opds.form.basic" }) as HTMLInputElement).checked,
    ).toBe(true);

    await userEvent.type(screen.getByLabelText("library.opds.form.name"), "Private shelf");
    await userEvent.type(
      screen.getByLabelText("library.opds.form.url"),
      "https://catalog.test/opds",
    );
    await userEvent.type(screen.getByLabelText("library.opds.form.username"), "reader");
    await userEvent.type(screen.getByLabelText("library.opds.form.password"), "secret");
    expect(screen.getByRole("button", { name: "library.opds.showPassword" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "library.opds.save" }));

    await waitFor(() => expect(addCatalog).toHaveBeenCalledOnce());
    expect(addCatalog.mock.calls[0]?.[0]).toMatchObject({
      name: "Private shelf",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "secret",
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
