import type { Locator, Page } from "@playwright/test";

/**
 * Page Object Model for the category target entry section of the Budget Planner.
 *
 * Encapsulates locators for the target entry form, saved targets list, save/update
 * controls, and validation feedback rendered by CategoryTargetEntrySection.tsx.
 *
 * Assertions belong in specs — this object exposes locators only.
 */
export class CategoryTargetPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The landmark region wrapping the category target entry section. */
  get section() {
    return this.page.getByRole("region", { name: "Category Target Entry" });
  }

  /** The section heading rendered inside CategoryTargetEntrySection. */
  get heading() {
    return this.page.getByRole("heading", { name: "Set Category Budget Target", level: 2 });
  }

  /** The category ID text input field. */
  get categoryIdInput() {
    return this.page.getByRole("textbox", { name: "Category ID", exact: true });
  }

  /** The target amount number input field (spinbutton role for type="number"). */
  get targetAmountInput() {
    return this.page.getByRole("spinbutton", { name: "Target amount" });
  }

  /** The save button that submits the entry form. */
  get saveButton() {
    return this.page.getByRole("button", { name: "Save target" });
  }

  /** The list of saved category targets for the selected month. */
  get savedTargetsList() {
    return this.page.getByRole("list", { name: "Saved category targets" });
  }

  /** Returns a locator for the saved target list item matching the given category ID. */
  savedTargetItem(categoryId: string): Locator {
    return this.savedTargetsList.getByRole("listitem").filter({ hasText: categoryId });
  }

  /** Validation error alert shown when input is rejected. */
  get validationError() {
    return this.page.getByRole("alert");
  }

  /** Success status message shown after a target is saved. */
  get savedConfirmation() {
    return this.page.getByRole("status");
  }
}
