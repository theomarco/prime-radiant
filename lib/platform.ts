/**
 * Workspace fixture for the platform pages.
 *
 * The page is four stages in a fixed order: where the data comes from, how the
 * business problem becomes a scored table, what the scores say and why, and
 * what acts on them. Adding a team means adding a workspace here, not building
 * a screen.
 *
 * Everything below is invented. No customer name, vendor name, or real volume
 * belongs in this file. Sources are named by the job they do rather than by the
 * product that does it.
 */

export type Unit = "money" | "pct" | "millions" | "thousands" | "count";

const FORMAT: Record<Unit, (n: number) => string> = {
  money: (n) => `$${n.toFixed(2)}`,
  pct: (n) => `${n.toFixed(1)}%`,
  millions: (n) => `${n.toFixed(2)}M`,
  thousands: (n) => `${Math.round(n)}k`,
  count: (n) => n.toLocaleString("en-US"),
};

export function formatUnit(unit: Unit, n: number) {
  return FORMAT[unit](n);
}

/* ------------------------------------------------------------ 01 sources --- */

export type Source = {
  name: string;
  kind: string;
  provides: string;
  volume: string;
  sync: string;
};

/* ------------------------------------------------------------ 02 framing --- */

/** One scored table. The model produces these; it does not produce decisions. */
export type Task = {
  id: string;
  question: string;
  entity: string;
  label: string;
  horizon: string;
  positiveRate: string;
  labelled: string;
  /** Aggregate of one run's scores, oldest first. Not a forecast curve. */
  predicted: number[];
  /** Outcomes. Shorter than `predicted`: recent runs have not closed yet. */
  actual: number[];
  unit: Unit;
};

/* -------------------------------------------------------- 03 predictions --- */

export type Contribution = { feature: string; value: string; effect: number };

export type ScoredRow = {
  id: string;
  score: number;
  band: "hold" | "watch" | "send";
  /** Signed contributions to this row's score, largest first. */
  contributions: Contribution[];
  /** Everything under the noise floor, rolled up. */
  rest: number;
};

export type DistributionBin = { bin: string; atRisk: number; rest: number };

/* ----------------------------------------------------------- 04 workflow --- */

export type Measure = {
  name: string;
  treated: string;
  control: string;
  delta: string;
  /** Whether the movement is the one the team asked for. */
  good: boolean;
};

export type Workspace = {
  industry: string;
  department: string;
  industrySlug: string;
  departmentSlug: string;
  company: string;
  title: string;
  blurb: string;

  problem: string;
  sources: Source[];
  joinNote: string;

  decision: string;
  tasks: Task[];
  policy: { rule: string; note: string };

  /** Baseline rate before any feature moves it, for the waterfall. */
  baseline: number;
  scored: ScoredRow[];
  driver: { feature: string; note: string; bins: DistributionBin[] };

  queue: { candidates: string; held: string; allowed: string; holdout: string };
  measures: Measure[];
  measuredNote: string;
  schedule: string;
};

const sendDecisioning: Workspace = {
  industry: "Ecommerce",
  department: "CRM",
  industrySlug: "ecommerce",
  departmentSlug: "crm",
  company: "Vestral",
  title: "One customer, four messages about the same jacket, and nobody counting.",
  blurb:
    "Campaigns fire on their own triggers. A price drop sends one message, low stock sends another, the weekly promotion sends a third. No one owns the total. This is what it takes to put a decision in front of every send.",

  /* ------------------------------------------------------------- 01 --- */
  problem:
    "The cross-campaign problem exists because these tables live apart. Price and stock trigger their own sends, the calendar adds its own, and nothing joins them to what the customer already received this week.",
  sources: [
    {
      name: "Engagement platform",
      kind: "Two-way connector",
      provides: "Sends, opens, clicks, opt-outs. Audiences and scores go back.",
      volume: "2.1B events",
      sync: "Hourly",
    },
    {
      name: "Customer data platform",
      kind: "CDP connector",
      provides: "Profiles, app sessions, push tokens, uninstall signals",
      volume: "16.4M profiles",
      sync: "Every 6h",
    },
    {
      name: "Product catalog",
      kind: "Warehouse table",
      provides: "Price changes and stock levels, which fire two of the campaigns",
      volume: "88k options",
      sync: "Hourly",
    },
    {
      name: "Orders and returns",
      kind: "Warehouse table",
      provides: "Transactions, so a send can be valued rather than counted",
      volume: "190M rows",
      sync: "Nightly",
    },
    {
      name: "Campaign calendar",
      kind: "API connector",
      provides: "Scheduled promotions and releases, the messages nobody triggers",
      volume: "1,240 campaigns",
      sync: "Hourly",
    },
  ],
  joinNote:
    "Joined on the customer, they become one table: what was sent, about which product, how the customer responded, and what state they were in at the time.",

  /* ------------------------------------------------------------- 02 --- */
  decision: "Should this message go to this customer now?",
  tasks: [
    {
      id: "fatigue_30d",
      question: "Is this customer about to disengage?",
      entity: "customer",
      label: "opted out, uninstalled, or went quiet within 30 days",
      horizon: "30 days",
      positiveRate: "2.4%",
      labelled: "16.4M rows, 18 months",
      predicted: [2.7, 2.6, 2.6, 2.5, 2.5, 2.4, 2.4, 2.3, 2.3, 2.4, 2.5, 2.5],
      actual: [2.8, 2.5, 2.7, 2.5, 2.4, 2.4, 2.5, 2.3, 2.2, 2.4, 2.4],
      unit: "pct",
    },
    {
      id: "response_72h",
      question: "Would this customer act on this message?",
      entity: "customer x candidate message",
      label: "opened, clicked, or ordered within 72 hours",
      horizon: "72 hours",
      positiveRate: "11.8%",
      labelled: "2.1B send events",
      predicted: [11.2, 11.4, 11.3, 11.6, 11.5, 11.7, 11.8, 11.9, 11.8, 12.0, 12.1, 12.2],
      actual: [11.0, 11.5, 11.2, 11.7, 11.4, 11.8, 11.7, 12.0, 11.9, 12.0, 12.2],
      unit: "pct",
    },
  ],
  policy: {
    rule: "hold when  expected value of the send  <  fatigue risk x value of the relationship",
    note:
      "This is the one part that is not a model, and it should stay that way. Two scores go in, a send or a hold comes out, and marketing owns both thresholds. A model that emitted the decision directly would hide the trade-off the marketing team needs to tune.",
  },

  /* ------------------------------------------------------------- 03 --- */
  baseline: 0.024,
  scored: [
    {
      id: "customer 8842190",
      score: 0.366,
      band: "hold",
      contributions: [
        { feature: "sends, last 7 days", value: "9", effect: 0.121 },
        { feature: "repeat sends, same product", value: "4", effect: 0.098 },
        { feature: "opens, last 30 days", value: "1", effect: 0.074 },
        { feature: "app sessions, last 30 days", value: "0", effect: 0.041 },
        { feature: "days since last order", value: "96", effect: 0.019 },
        { feature: "tenure", value: "38 months", effect: -0.022 },
      ],
      rest: 0.011,
    },
    {
      id: "customer 4417806",
      score: 0.212,
      band: "hold",
      contributions: [
        { feature: "sends, last 7 days", value: "11", effect: 0.134 },
        { feature: "repeat sends, same product", value: "3", effect: 0.062 },
        { feature: "clicks, last 30 days", value: "0", effect: 0.038 },
        { feature: "days since last order", value: "12", effect: -0.048 },
        { feature: "orders, last 12 months", value: "14", effect: -0.031 },
      ],
      rest: 0.033,
    },
    {
      id: "customer 1120553",
      score: 0.094,
      band: "watch",
      contributions: [
        { feature: "sends, last 7 days", value: "6", effect: 0.052 },
        { feature: "opens, last 30 days", value: "4", effect: -0.019 },
        { feature: "app sessions, last 30 days", value: "7", effect: -0.024 },
        { feature: "repeat sends, same product", value: "2", effect: 0.031 },
      ],
      rest: 0.03,
    },
    {
      id: "customer 9903471",
      score: 0.018,
      band: "send",
      contributions: [
        { feature: "opens, last 30 days", value: "19", effect: -0.028 },
        { feature: "app sessions, last 30 days", value: "22", effect: -0.021 },
        { feature: "sends, last 7 days", value: "3", effect: 0.014 },
        { feature: "days since last order", value: "5", effect: -0.019 },
      ],
      rest: 0.048,
    },
  ],
  driver: {
    feature: "sends in the last 7 days",
    note:
      "The one feature the marketing team can actually pull. Disengagement is flat to about five sends a week and climbs steeply after that, which is where the untracked cross-campaign overlap lands people.",
    bins: [
      { bin: "0 to 2", atRisk: 0.6, rest: 99.4 },
      { bin: "3 to 4", atRisk: 1.1, rest: 98.9 },
      { bin: "5 to 6", atRisk: 2.2, rest: 97.8 },
      { bin: "7 to 8", atRisk: 5.8, rest: 94.2 },
      { bin: "9 to 11", atRisk: 12.4, rest: 87.6 },
      { bin: "12 or more", atRisk: 21.7, rest: 78.3 },
    ],
  },

  /* ------------------------------------------------------------- 04 --- */
  queue: {
    candidates: "4.21M",
    held: "890k",
    allowed: "3.32M",
    holdout: "10%",
  },
  measures: [
    { name: "Revenue per customer", treated: "$18.40", control: "$18.46", delta: "-0.3%, inside noise", good: true },
    { name: "Marketing opt-out rate", treated: "1.9%", control: "2.6%", delta: "down 27%", good: true },
    { name: "App uninstall rate", treated: "0.7%", control: "0.9%", delta: "down 22%", good: true },
    { name: "Sends per customer per week", treated: "4.1", control: "6.8", delta: "down 40%", good: true },
  ],
  measuredNote:
    "Six weeks against a 10% control that receives everything regardless of score. The control is not a nicety here: revenue holding flat is a claim that can only be made against one, and it is the claim the whole case rests on.",
  schedule:
    "Sources sync through the night and hourly through the day. Fatigue is scored at 06:00. Response is scored per candidate message, in the send window.",
};

export const WORKSPACES: Workspace[] = [sendDecisioning];

export function findWorkspace(industry: string, department: string) {
  return WORKSPACES.find((w) => w.industrySlug === industry && w.departmentSlug === department);
}

export function workspacePath(w: Workspace) {
  return `/platform/${w.industrySlug}/${w.departmentSlug}`;
}
