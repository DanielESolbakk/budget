import type { Page } from "@playwright/test";

export class CategoryManagementPage {
  constructor(private readonly page: Page) {}

  get opener() { return this.page.getByRole("button", { name: "Manage categories", exact: true }); }
  get dialog() { return this.page.getByRole("dialog", { name: "Manage categories", exact: true }); }
  get newName() { return this.dialog.getByRole("textbox", { name: "New category name", exact: true }); }
  get searchInput() { return this.dialog.getByRole("searchbox", { name: "Find a category", exact: true }); }
  get error() { return this.dialog.getByRole("alert"); }
  get result() { return this.dialog.getByRole("status", { name: "Category management result" }); }
  category(name: string) { return this.dialog.getByRole("listitem").filter({ hasText: name }); }

  async open(): Promise<void> { await this.opener.click(); }
  async openFrom(name: string): Promise<void> {
    await this.page.getByRole("button", { name, exact: true }).click();
  }
  async create(name: string): Promise<void> {
    await this.newName.fill(name);
    await this.dialog.getByRole("button", { name: "Create category", exact: true }).click();
  }
  async rename(name: string, replacement: string): Promise<void> {
    await this.dialog.getByRole("button", { name: `Rename ${name}`, exact: true }).click();
    await this.dialog.getByRole("textbox", { name: "Category name", exact: true }).fill(replacement);
    await this.dialog.getByRole("textbox", { name: "Category name", exact: true }).press("Enter");
  }
  async close(): Promise<void> {
    await this.dialog.getByRole("button", { name: "Close category management", exact: true }).click();
  }
}
