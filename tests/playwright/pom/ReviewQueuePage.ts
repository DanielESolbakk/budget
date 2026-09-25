import type { Page } from "@playwright/test";

export class ReviewQueuePage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get section() {
    return this.page.getByRole("region", { name: "Categorization Review" });
  }

  get heading() {
    return this.section.getByRole("heading", { name: "Categorization Review", level: 2 });
  }

  reviewItem(merchantRaw: string) {
    return this.section.getByRole("listitem", { name: `Review ${merchantRaw}` });
  }

  categorySelect(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByRole("combobox", {
      name: `Category for ${merchantRaw}`,
    });
  }

  saveButton(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByRole("button", { name: "Save category" });
  }
}
