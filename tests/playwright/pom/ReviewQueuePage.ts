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

  get propagationPreviewButton() {
    return this.section.getByRole("button", { name: /^Preview \d+ matching transactions$/ });
  }

  get propagationPreviewDialog() {
    return this.section.getByRole("dialog", { name: "Same-merchant transaction preview" });
  }

  get propagationCandidateRows() {
    return this.propagationPreviewDialog.getByRole("listitem");
  }

  get cancelPropagationPreviewButton() {
    return this.propagationPreviewDialog.getByRole("button", { name: "Cancel" });
  }

  get continuePropagationButton() {
    return this.propagationPreviewDialog.getByRole("button", { name: "Continue to confirmation" });
  }

  get propagationConfirmationDialog() {
    return this.section.getByRole("alertdialog", { name: "Confirm same-merchant propagation" });
  }

  get confirmPropagationButton() {
    return this.propagationConfirmationDialog.getByRole("button", { name: /^Apply category to \d+ transactions?$/ });
  }

  get propagationResult() {
    return this.section.getByRole("status", { name: "Propagation result" });
  }

  get undoPropagationButton() {
    return this.section.getByRole("button", { name: "Undo propagation" });
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
    return this.section.getByRole("listitem", { name: `Review ${merchantRaw}`, exact: true });
  }

  propagationCandidate(merchantRaw: string, bookedAtDate: string) {
    return this.propagationCandidateRows
      .filter({ hasText: merchantRaw })
      .filter({ hasText: bookedAtDate });
  }

  propagationCandidateCheckbox(merchantRaw: string, bookedAtDate: string) {
    return this.propagationCandidate(merchantRaw, bookedAtDate).getByRole("checkbox");
  }

  confidenceLabel(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByText(/Confidence:/);
  }

  proposedCategoryLabel(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByText(/Proposed category:/);
  }

  matchingRulesLabel(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByText(/Matching rules:/);
  }

  categorySelect(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByRole("combobox", {
      name: `Category for ${merchantRaw}`,
      exact: true,
    });
  }

  saveButton(merchantRaw: string) {
    return this.reviewItem(merchantRaw).getByRole("button", { name: "Save category" });
  }
}
