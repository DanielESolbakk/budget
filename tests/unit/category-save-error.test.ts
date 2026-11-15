import { describe, expect, it } from "vitest";
import { categorySaveError } from "../../src/renderer/categories/categorySaveError.js";

describe("category save error presentation", () => {
  it.each(["create", "rename"])("makes an IPC %s name conflict actionable without transport wording", (mode) => {
    const error = categorySaveError(new Error(
      `Error invoking remote method 'category:${mode}': Error: A category with this name already exists.`,
    ));
    expect(error.nameInvalid).toBe(true);
    expect(error.message).toMatch(/already exists.*choose a different name/i);
    expect(error.message).not.toMatch(/remote method|category:(create|rename)/);
  });

  it("identifies a blank name as an input problem", () => {
    const error = categorySaveError(new Error("Category name must be a non-empty string."));
    expect(error.nameInvalid).toBe(true);
    expect(error.message).toMatch(/enter a category name/i);
  });

  it("keeps an unexpected persistence failure explicit without blaming the name", () => {
    expect(categorySaveError(new Error(
      "Error invoking remote method 'category:create': Error: synthetic category save failure",
    ))).toEqual({ message: "synthetic category save failure", nameInvalid: false });
  });

  it("still reports a failed save when IPC supplies no error detail", () => {
    const error = categorySaveError(new Error("Error invoking remote method 'category:rename': Error: "));
    expect(error.nameInvalid).toBe(false);
    expect(error.message).toMatch(/unable to save/i);
  });
});
