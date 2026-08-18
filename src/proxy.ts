import { type NextRequest, NextResponse } from "next/server";

import { isAllowedLoopbackHost } from "@/server/host-validation";

export function proxy(request: NextRequest): NextResponse {
  if (!isAllowedLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
