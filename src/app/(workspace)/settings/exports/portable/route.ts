import { createPortableFinancialExport } from "@/features/exports/portable-export-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const result = await createPortableFinancialExport();
  return new Response(result.content, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
