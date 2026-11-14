export interface CategorySaveError {
  message: string;
  nameInvalid: boolean;
}

export function categorySaveError(failure: unknown): CategorySaveError {
  const message = failure instanceof Error ? failure.message : "Unable to save the category.";
  const detail = message.replace(/^Error invoking remote method 'category:(?:create|rename)': (?:Error: )?/, "");
  if (detail === "Category name must be a non-empty string." || detail === "label must be a non-empty string.") {
    return { message: "Enter a category name.", nameInvalid: true };
  }
  if (detail === "A category with this name already exists.") {
    return { message: "A category with this name already exists. Choose a different name.", nameInvalid: true };
  }
  return {
    message: detail.length > 0 ? detail : "Unable to save the category. No error details were provided.",
    nameInvalid: false,
  };
}
