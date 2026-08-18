"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPublicErrorMessage } from "@/domain/errors";
import {
  archiveCategory,
  createCategory,
  restoreCategory,
} from "@/features/categories/category-service";
import type { FormActionState } from "@/features/forms/action-state";

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(60),
  kind: z.enum(["income", "expense"]),
});

export async function createCategoryAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the category details.",
    };
  }

  try {
    await createCategory(parsed.data);
    revalidatePath("/settings");
    revalidatePath("/transactions");

    return {
      status: "success",
      message: `${parsed.data.name} is ready to use.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The category could not be created."),
    };
  }
}

const categoryIdSchema = z.coerce.number().int().positive();

export async function archiveCategoryAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const categoryId = categoryIdSchema.safeParse(formData.get("categoryId"));

  if (!categoryId.success) {
    return {
      status: "error",
      message: "The category identifier is invalid.",
    };
  }

  try {
    await archiveCategory(categoryId.data);
    revalidatePath("/settings");
    revalidatePath("/transactions");

    return {
      status: "success",
      message: "The category was archived. Historical entries remain unchanged.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The category could not be archived."),
    };
  }
}

export async function restoreCategoryAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const categoryId = categoryIdSchema.safeParse(formData.get("categoryId"));

  if (!categoryId.success) {
    return {
      status: "error",
      message: "The category identifier is invalid.",
    };
  }

  try {
    await restoreCategory(categoryId.data);
    revalidatePath("/settings");
    revalidatePath("/transactions");

    return {
      status: "success",
      message: "The category is available for corrections again.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The category could not be restored."),
    };
  }
}
