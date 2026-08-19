import type { Metadata } from "next";

import {
  getTransferClearingBalance,
  getOutsideScopeTransferBalance,
  listTransferWorkspaceRows,
} from "@/features/transfers/transfer-service";
import { TransferWorkspace } from "@/features/transfers/transfer-workspace";

export const metadata: Metadata = {
  title: "Transfers",
};

export default async function TransfersPage() {
  const [rows, clearing, outsideScope] = await Promise.all([
    listTransferWorkspaceRows(),
    getTransferClearingBalance(),
    getOutsideScopeTransferBalance(),
  ]);

  return (
    <TransferWorkspace
      clearingBalanceMinor={clearing.amountMinor}
      outsideScopeBalanceMinor={outsideScope.amountMinor}
      rows={rows}
    />
  );
}
