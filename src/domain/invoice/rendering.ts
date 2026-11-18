import { parseDateInput } from "../../lib/time.ts";
import type { Doc } from "../../store/collection.ts";
import type { Tenant } from "../../tenant/tenant.ts";
import { toNumber } from "../shared/money.ts";
import { type RenderedDocument, renderDocument } from "../shared/rendering.ts";
import { invoicePositions } from "./positions.ts";

/** Renders the deterministic placeholder PDF of an invoice (see shared/rendering.ts). */
export function renderInvoice(tenant: Tenant, invoice: Doc): RenderedDocument {
  return renderDocument(tenant, invoice, {
    numberField: "invoiceNumber",
    numberLabel: "Rechnungsnummer",
    dateField: "invoiceDate",
    dateLabel: "Rechnungsdatum",
    fallbackName: `Invoice-${invoice.id}`,
    positions: invoicePositions(tenant, invoice.id),
  });
}

/**
 * GET /Invoice/{id}/getXml: a minimal, deterministic UN/CEFACT CII document with number,
 * date, positions and totals. Assumption: it is returned for every invoice; it is not a
 * validated XRechnung.
 */
export function renderInvoiceXml(tenant: Tenant, invoice: Doc): string {
  const currency = xml(invoice.currency ?? "EUR");
  const issueDate = parseDateInput(invoice.invoiceDate)?.toFormat("yyyyLLdd") ?? "";
  const typeCode = invoice.invoiceType === "SR" ? "384" : "380";
  const lineItems = invoicePositions(tenant, invoice.id).map(
    (pos, index) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${index + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${xml(pos.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${decimal(pos.priceNet)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${decimal(pos.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${decimal(pos.taxRate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${decimal(pos.sumNet)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
  );
  const due = decimal(toNumber(invoice.sumGross) - toNumber(invoice.paidAmount));
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${xml(invoice.invoiceNumber)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${issueDate}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lineItems.join("\n")}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${decimal(invoice.sumNet)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${decimal(invoice.sumNet)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${currency}">${decimal(invoice.sumTax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${decimal(invoice.sumGross)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${due}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function xml(value: unknown): string {
  return text(value).replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function decimal(value: unknown): string {
  return toNumber(value).toFixed(2);
}
