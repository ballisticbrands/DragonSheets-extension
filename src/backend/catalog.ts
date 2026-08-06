/**
 * Static catalog data for the mock backend: the report catalog (names mirror
 * the real BigQuery catalog — SP-API core + Ads v3 — so the mock matches what
 * Phase 8's backend can actually serve) and the solution templates.
 *
 * Kept out of mock.ts so the behavioural mock stays readable.
 */
import type {
  FieldType,
  ReportCatalogEntry,
  ReportField,
  Template,
} from "./types";

function f(id: string, name: string, type: FieldType, sample: string): ReportField {
  return { id, name, type, sample };
}

const DATE = f("date", "Date", "date", "2026-07-14");
const ASIN = f("asin", "ASIN", "string", "B08K2LR7QP");
const SKU = f("sku", "SKU", "string", "BB-CRM-04");
const CAMPAIGN = f("campaign", "Campaign", "string", "SP | Creatine | Exact");
const IMPRESSIONS = f("impressions", "Impressions", "number", "18,402");
const CLICKS = f("clicks", "Clicks", "number", "214");
const SPEND = f("spend", "Spend", "currency", "312.46");
const SALES_14D = f("sales_14d", "Sales 14d", "currency", "1,204.90");

export const REPORT_CATALOG: ReportCatalogEntry[] = [
  {
    id: "sc-orders",
    name: "Orders",
    source: "seller-central",
    description: "Order-level detail: status, SKU, quantities, revenue.",
    fields: [
      f("order_id", "Order ID", "string", "112-3948571-2938475"),
      f("purchase_date", "Purchase Date", "date", "2026-07-14"),
      SKU,
      ASIN,
      f("quantity", "Order Quantity", "number", "2"),
      f("item_price", "Item Price", "currency", "24.99"),
      f("order_status", "Order Status", "string", "Shipped"),
      f("marketplace", "Marketplace", "string", "US"),
    ],
    joinKeys: ["asin", "sku", "purchase_date"],
    rowEstimate: 42000,
  },
  {
    id: "sc-sales-traffic-asin",
    name: "Sales & Traffic by ASIN",
    source: "seller-central",
    description: "Sessions, page views, buy-box %, units and revenue per ASIN per day.",
    fields: [
      DATE,
      ASIN,
      f("sessions", "Sessions", "number", "1,940"),
      f("page_views", "Page Views", "number", "2,610"),
      f("buy_box_pct", "Buy Box %", "percent", "96.4"),
      f("units_ordered", "Units Ordered", "number", "148"),
      f("ordered_product_sales", "Ordered Product Sales", "currency", "3,698.52"),
    ],
    joinKeys: ["asin", "date"],
    rowEstimate: 18600,
  },
  {
    id: "sc-fba-inventory",
    name: "FBA Inventory",
    source: "seller-central",
    description: "Fulfillable, inbound, reserved and unsellable units per SKU.",
    fields: [
      SKU,
      ASIN,
      f("fulfillable_qty", "Fulfillable Qty", "number", "412"),
      f("inbound_qty", "Inbound Qty", "number", "600"),
      f("reserved_qty", "Reserved Qty", "number", "38"),
      f("unsellable_qty", "Unsellable Qty", "number", "7"),
    ],
    joinKeys: ["sku", "asin"],
    rowEstimate: 640,
  },
  {
    id: "sc-fees",
    name: "Fee Preview",
    source: "seller-central",
    description: "Estimated referral + FBA fees per SKU.",
    fields: [
      SKU,
      ASIN,
      f("price", "Price", "currency", "24.99"),
      f("referral_fee", "Referral Fee", "currency", "3.75"),
      f("fba_fee", "FBA Fee", "currency", "5.44"),
      f("total_fee_estimate", "Total Fee Estimate", "currency", "9.19"),
    ],
    joinKeys: ["sku", "asin"],
    rowEstimate: 640,
  },
  {
    id: "sc-returns",
    name: "FBA Returns",
    source: "seller-central",
    description: "Customer returns with reason codes and disposition.",
    fields: [
      f("return_date", "Return Date", "date", "2026-07-11"),
      f("order_id", "Order ID", "string", "112-3948571-2938475"),
      SKU,
      ASIN,
      f("quantity", "Returned Quantity", "number", "1"),
      f("reason", "Return Reason", "string", "DEFECTIVE"),
      f("disposition", "Disposition", "string", "SELLABLE"),
    ],
    joinKeys: ["sku", "asin", "return_date"],
    rowEstimate: 1240,
  },
  {
    id: "sc-reimbursements",
    name: "Reimbursements",
    source: "seller-central",
    description: "FBA reimbursements: lost, damaged, fee corrections.",
    fields: [
      f("approval_date", "Approval Date", "date", "2026-07-09"),
      f("case_id", "Case ID", "string", "16284739201"),
      SKU,
      ASIN,
      f("quantity", "Reimbursed Quantity", "number", "3"),
      f("amount", "Amount", "currency", "74.97"),
      f("reason", "Reimbursement Reason", "string", "WAREHOUSE_DAMAGE"),
    ],
    joinKeys: ["sku", "asin", "approval_date"],
    rowEstimate: 310,
  },
  {
    id: "sc-search-query-perf",
    name: "Search Query Performance",
    source: "seller-central",
    description: "Brand-analytics query funnel: impressions, clicks, purchases per search query.",
    fields: [
      DATE,
      ASIN,
      f("query", "Search Query", "string", "creatine monohydrate"),
      IMPRESSIONS,
      CLICKS,
      f("cart_adds", "Cart Adds", "number", "61"),
      f("purchases", "Purchases", "number", "34"),
      f("purchase_share", "Purchase Share", "percent", "12.8"),
    ],
    joinKeys: ["asin", "date"],
    rowEstimate: 9800,
  },
  {
    id: "ads-sp-campaigns",
    name: "Sponsored Products — Campaigns",
    source: "ads",
    description: "Campaign-level spend, sales, ACOS and clicks per day.",
    fields: [
      DATE,
      CAMPAIGN,
      IMPRESSIONS,
      CLICKS,
      SPEND,
      SALES_14D,
      f("acos", "ACOS", "percent", "25.9"),
      f("orders_14d", "Orders 14d", "number", "48"),
    ],
    joinKeys: ["date", "campaign"],
    rowEstimate: 5400,
  },
  {
    id: "ads-sp-search-terms",
    name: "Sponsored Products — Search Terms",
    source: "ads",
    description: "Actual customer search terms with performance per term.",
    fields: [
      DATE,
      CAMPAIGN,
      f("ad_group", "Ad Group", "string", "Exact | core"),
      f("search_term", "Search Term", "string", "creatine gummies"),
      IMPRESSIONS,
      CLICKS,
      SPEND,
      SALES_14D,
    ],
    joinKeys: ["date", "campaign", "search_term"],
    rowEstimate: 68000,
  },
  {
    id: "ads-sp-advertised-product",
    name: "Sponsored Products — Advertised Product",
    source: "ads",
    description: "Per-advertised-ASIN ad performance.",
    fields: [DATE, CAMPAIGN, ASIN, SKU, IMPRESSIONS, CLICKS, SPEND, SALES_14D],
    joinKeys: ["date", "asin", "sku"],
    rowEstimate: 21000,
  },
  {
    id: "ads-sp-targeting",
    name: "Sponsored Products — Targeting",
    source: "ads",
    description: "Keyword / product-target level performance.",
    fields: [
      DATE,
      CAMPAIGN,
      f("ad_group", "Ad Group", "string", "Exact | core"),
      f("targeting", "Targeting", "string", "creatine monohydrate"),
      f("match_type", "Match Type", "string", "EXACT"),
      IMPRESSIONS,
      CLICKS,
      SPEND,
      SALES_14D,
    ],
    joinKeys: ["date", "campaign", "targeting"],
    rowEstimate: 32000,
  },
  {
    id: "ads-sb-campaigns",
    name: "Sponsored Brands — Campaigns",
    source: "ads",
    description: "SB campaign performance including new-to-brand metrics.",
    fields: [
      DATE,
      CAMPAIGN,
      IMPRESSIONS,
      CLICKS,
      SPEND,
      SALES_14D,
      f("ntb_orders_14d", "New-to-Brand Orders 14d", "number", "19"),
    ],
    joinKeys: ["date", "campaign"],
    rowEstimate: 2100,
  },
  {
    id: "ads-sd-campaigns",
    name: "Sponsored Display — Campaigns",
    source: "ads",
    description: "SD campaign performance across audiences.",
    fields: [
      DATE,
      CAMPAIGN,
      f("tactic", "Tactic", "string", "T00020"),
      IMPRESSIONS,
      CLICKS,
      SPEND,
      SALES_14D,
    ],
    joinKeys: ["date", "campaign"],
    rowEstimate: 1800,
  },
  {
    id: "ads-placements",
    name: "Sponsored Products — Placements",
    source: "ads",
    description: "Top-of-search vs product-page vs rest-of-search split.",
    fields: [
      DATE,
      CAMPAIGN,
      f("placement", "Placement", "string", "Top of Search (first page)"),
      IMPRESSIONS,
      CLICKS,
      SPEND,
      SALES_14D,
    ],
    joinKeys: ["date", "campaign", "placement"],
    rowEstimate: 4200,
  },
];

export const TEMPLATES: Template[] = [
  {
    id: "tpl-pnl-sku",
    name: "P&L by SKU",
    description: "Revenue, Amazon fees and ad spend per SKU — with margin already calculated.",
    category: "profitability",
    reportIds: ["sc-sales-traffic-asin", "sc-fees", "ads-sp-advertised-product"],
    highlights: [
      "Blends sales, fee preview and ad spend on ASIN",
      "Net margin % as a calculated column",
      "Refreshes daily, so month-end is already done",
    ],
    sheetName: "P&L by SKU",
  },
  {
    id: "tpl-tacos",
    name: "TACOS dashboard",
    description: "Total ad cost of sale, trended daily against total revenue.",
    category: "advertising",
    reportIds: ["sc-sales-traffic-asin", "ads-sp-campaigns"],
    highlights: [
      "Ad spend over total sales, not just attributed sales",
      "Daily rows ready to pivot or chart",
      "Catches the month where ads quietly ate the margin",
    ],
    sheetName: "TACOS",
  },
  {
    id: "tpl-restock",
    name: "Restock planner",
    description: "FBA inventory against real sales velocity, with days of cover per SKU.",
    category: "inventory",
    reportIds: ["sc-fba-inventory", "sc-orders"],
    highlights: [
      "Fulfillable + inbound units next to 30-day velocity",
      "Days of cover as a calculated column",
      "Sorted so the stockouts float to the top",
    ],
    sheetName: "Restock",
  },
  {
    id: "tpl-search-terms",
    name: "Search-term explorer",
    description: "Every search term that spent money, with a waste flag on the zero-sale ones.",
    category: "advertising",
    reportIds: ["ads-sp-search-terms"],
    highlights: [
      "Search term, spend, sales and ACOS per day",
      "Wasted-spend flag for terms with clicks and no orders",
      "The negative-keyword list writes itself",
    ],
    sheetName: "Search Terms",
  },
  {
    id: "tpl-returns",
    name: "Returns monitor",
    description: "Return rate per SKU with the reason codes behind it.",
    category: "operations",
    reportIds: ["sc-returns", "sc-orders"],
    highlights: [
      "Returns joined to orders on SKU",
      "Return rate % as a calculated column",
      "Reason and disposition kept, so you can see why",
    ],
    sheetName: "Returns",
  },
  {
    id: "tpl-inventory-health",
    name: "Inventory health",
    description: "Aged, unsellable and reserved units next to what's actually selling.",
    category: "inventory",
    reportIds: ["sc-fba-inventory", "sc-sales-traffic-asin", "sc-reimbursements"],
    highlights: [
      "Unsellable and reserved units surfaced per SKU",
      "Sell-through against sessions and units ordered",
      "Reimbursements alongside, so shrinkage is visible",
    ],
    sheetName: "Inventory Health",
  },
];

export const TEMPLATE_CATEGORY_LABEL: Record<Template["category"], string> = {
  profitability: "Profitability",
  advertising: "Advertising",
  inventory: "Inventory",
  operations: "Operations",
};
