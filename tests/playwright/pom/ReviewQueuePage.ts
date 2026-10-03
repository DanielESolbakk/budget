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

  get loadingStatus() {
    return this.section.getByRole("status").filter({ hasText: "Loading categorization queue..." });
  }

  get progressStatus() {
    return this.section.getByRole("status", { name: "Review queue progress" });
  }

  get savedStatus() {
    return this.section.getByRole("status", { name: "Category correction result" });
  }

  get firstCategorySelect() {
    return this.section.getByRole("combobox").first();
  }

  get errorAlert() {
    return this.section.getByRole("alert");
  }

  get retryButton() {
    return this.section.getByRole("button", { name: "Retry categorization queue" });
  }

  get emptyState() {
    return this.section.getByText("Nothing needs your attention.", { exact: true });
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
