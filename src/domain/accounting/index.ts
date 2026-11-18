import type { DomainModule } from "../../routes/types.ts";
import { checkAccountRoutes } from "./checkAccounts.ts";
import { exportRoutes } from "./exports.ts";
import { guidanceRoutes } from "./guidance.ts";
import { transactionRoutes } from "./transactions.ts";
import { uploadRoutes } from "./uploads.ts";
import { voucherRoutes } from "./voucher.ts";
import { voucherFactoryRoutes } from "./voucherFactory.ts";

export { createClearingAccount, createFileImportAccount } from "./checkAccounts.ts";
export { balanceAt } from "./transactions.ts";
export { bookVoucherAmount, VOUCHER_PAYABLE } from "./voucher.ts";
export { type SavedVoucher, saveVoucher } from "./voucherFactory.ts";

/** Bookkeeping: vouchers, check accounts and transactions, receipt guidance, reports, exports and document server helpers. */
export const accountingModule: DomainModule = {
  name: "accounting",
  models: [
    "Voucher",
    "VoucherPos",
    "VoucherLog",
    "Document",
    "CheckAccount",
    "CheckAccountTransaction",
    "ReceiptGuidance",
    "Report",
    "Export",
    "ExportJob",
    "Progress",
    "DocServer",
    "Textparser",
    "PrivateTransactionRule",
  ],
  routes: [
    ...voucherFactoryRoutes,
    ...uploadRoutes,
    ...voucherRoutes,
    ...checkAccountRoutes,
    ...transactionRoutes,
    ...guidanceRoutes,
    ...exportRoutes,
  ],
};
