// Rich sample content for screens with no real backend yet (Schedule,
// Selections, Documents, Updates & Photos, Conversations, Action
// Center). Restored directly from the original Phase 1 prototype's own
// sample data (SCHEDULE / SEED_SELECTIONS / DOCUMENTS / UPDATES) rather
// than reinvented — this file is intentionally scoped to the demo app
// (not packages/01-financial-engine or packages/02-app-shell) because
// none of these features have a real engine or repository yet; once
// they do, this hardcoded content is replaced by a real repository
// call, not extended in place.

export const CONTACT = {
  name: "Brent Leibee",
  role: "Principal / Stone Column",
  phone: "(770) 555-0148",
  email: "brent@stonecolumnhomes.com",
};

export interface SchedulePhase {
  name: string;
  status: "complete" | "in-progress" | "upcoming" | "not-started" | "delayed";
  range: string;
}

export const SCHEDULE: SchedulePhase[] = [
  { name: "Design & Selections", status: "complete", range: "Feb 2026" },
  { name: "Permitting", status: "complete", range: "Mar 2026" },
  { name: "Site Work", status: "complete", range: "May 2026" },
  { name: "Foundation", status: "complete", range: "Jun 2026" },
  { name: "Framing", status: "in-progress", range: "Jun – Aug 2026" },
  { name: "Dry-In", status: "upcoming", range: "Aug 2026" },
  { name: "Rough Mechanicals", status: "upcoming", range: "Sep 2026" },
  { name: "Insulation & Drywall", status: "not-started", range: "Oct 2026" },
  { name: "Interior Trim & Cabinets", status: "not-started", range: "Nov 2026" },
  { name: "Tile & Flooring", status: "not-started", range: "Dec 2026" },
  { name: "Painting", status: "not-started", range: "Dec 2026" },
  { name: "Fixtures & Appliances", status: "not-started", range: "Jan 2027" },
  { name: "Final Inspections", status: "not-started", range: "Jan 2027" },
  { name: "Punch List", status: "not-started", range: "Feb 2027" },
  { name: "Substantial Completion", status: "not-started", range: "Feb 2027" },
];

export interface Selection {
  id: string;
  category: string;
  room: string;
  title: string;
  product: string;
  allowanceCents: number;
  priceCents: number | null;
  status: "Approved" | "Ordered" | "Submitted for approval" | "Client decision required" | "Options being reviewed" | "Not started";
  approvedOn: string | null;
  approvedBy: string | null;
  note: string;
}

export const SELECTIONS: Selection[] = [
  { id: "sel1", category: "Exterior Materials", room: "Exterior", title: "Siding Color", product: "Board & Batten — James Hardie", allowanceCents: 1800000, priceCents: 1800000, status: "Approved", approvedOn: "Apr 12, 2026", approvedBy: "Jordan Carter", note: "Benjamin Moore HC-106 Crownsville Gray, satin finish." },
  { id: "sel2", category: "Roofing", room: "Exterior", title: "Roofing Material", product: "Standing Seam Metal — Charcoal", allowanceCents: 950000, priceCents: 1040000, status: "Approved", approvedOn: "Apr 18, 2026", approvedBy: "Alex Carter", note: "Upgrade from architectural shingle allowance; $900 over allowance." },
  { id: "sel3", category: "Windows", room: "Whole House", title: "Window Package", product: "Marvin Elevate — Black Clad", allowanceCents: 1400000, priceCents: 1400000, status: "Approved", approvedOn: "May 2, 2026", approvedBy: "Jordan Carter", note: "" },
  { id: "sel4", category: "Plumbing Fixtures", room: "Primary Bath", title: "Freestanding Tub", product: "Kohler — Underscore", allowanceCents: 220000, priceCents: 195000, status: "Client decision required", approvedOn: null, approvedBy: null, note: "Two options submitted for review — see attached spec sheets." },
  { id: "sel5", category: "Cabinets", room: "Kitchen", title: "Kitchen Cabinetry", product: "Custom Inset — Painted Cloud White", allowanceCents: 4800000, priceCents: 5250000, status: "Submitted for approval", approvedOn: null, approvedBy: null, note: "Upgraded to full-inset construction; $4,500 over allowance." },
  { id: "sel6", category: "Countertops", room: "Kitchen", title: "Kitchen Countertops", product: "Taj Mahal Quartzite", allowanceCents: 1600000, priceCents: 1480000, status: "Ordered", approvedOn: "Jun 30, 2026", approvedBy: "Alex Carter", note: "$1,200 under allowance." },
  { id: "sel7", category: "Flooring", room: "Main Living Areas", title: "Wide-Plank Flooring", product: "White Oak, Wire-Brushed", allowanceCents: 2400000, priceCents: null, status: "Options being reviewed", approvedOn: null, approvedBy: null, note: "Three finish samples on-site for review." },
  { id: "sel8", category: "Lighting", room: "Whole House", title: "Lighting Package", product: "TBD", allowanceCents: 1800000, priceCents: null, status: "Not started", approvedOn: null, approvedBy: null, note: "" },
];

export interface SampleDocument {
  name: string;
  category: string;
  date: string;
  visible: boolean;
}

export const DOCUMENTS: SampleDocument[] = [
  { name: "Construction Agreement — Hawks Ridge Residence", category: "Contract", date: "Jan 22, 2026", visible: true },
  { name: "Approved Architectural Plans (Rev. C)", category: "Plans", date: "Feb 18, 2026", visible: true },
  { name: "Original Estimate — Hawks Ridge", category: "Estimate", date: "Jan 30, 2026", visible: true },
  { name: "Change Order #1 — Roofing Upgrade", category: "Change Orders", date: "Apr 18, 2026", visible: true },
  { name: "Grading Permit", category: "Permits & Inspections", date: "Mar 4, 2026", visible: true },
  { name: "June Progress Report", category: "Progress Reports", date: "Jun 30, 2026", visible: false },
];

export interface SampleUpdate {
  title: string;
  date: string;
  published: boolean;
  completed: string;
  next: string;
  concerns: string;
}

export const UPDATES: SampleUpdate[] = [
  { title: "Framing underway on main structure", date: "Jul 14, 2026", published: true, completed: "First-floor walls and floor system are up. Roof trusses arrived on site Friday.", next: "Second-floor walls, then truss setting begins early next week weather permitting.", concerns: "One day lost to rain on 7/9 — schedule impact minimal." },
  { title: "Foundation complete, framing package delivered", date: "Jun 24, 2026", published: true, completed: "Slab and stem walls poured and cured. Waterproofing complete.", next: "Framing crew mobilizes Monday.", concerns: "None at this time." },
  { title: "Site work wrap-up", date: "May 30, 2026", published: false, completed: "Grading and pad prep complete, silt fencing installed.", next: "Footings layout and inspection.", concerns: "Draft — pending photos before publishing." },
];

export interface ConversationThread {
  subject: string;
  topic: string;
  participants: string;
  status: "Open" | "Waiting on Stone Column" | "Waiting on client" | "Resolved";
  lastMessage: string;
  date: string;
}

export const CONVERSATIONS: ConversationThread[] = [
  { subject: "Kitchen cabinet upgrade — approval needed", topic: "Selections", participants: "Brent Leibee, Jordan Carter", status: "Waiting on client", lastMessage: "Attached the full-inset spec sheet and updated pricing — let us know if this works for you.", date: "Jul 15, 2026" },
  { subject: "Question about tub options", topic: "Selections", participants: "Alex Carter, Brent Leibee", status: "Waiting on Stone Column", lastMessage: "Are both freestanding tub options the same install depth?", date: "Jul 14, 2026" },
  { subject: "Rain delay — schedule impact", topic: "Schedule", participants: "Brent Leibee, Jordan Carter, Alex Carter", status: "Resolved", lastMessage: "Confirmed — no material impact to the framing timeline.", date: "Jul 10, 2026" },
];

export interface ActionItem {
  action: string;
  project: string;
  owner: string;
  due: string;
  status: "Needs attention today" | "Waiting on client" | "Waiting on vendor" | "Upcoming this week";
}

export const ACTION_ITEMS: ActionItem[] = [
  { action: "Kitchen cabinetry — client approval needed", project: "Hawks Ridge Residence", owner: "Jordan Carter", due: "Jul 22, 2026", status: "Waiting on client" },
  { action: "Freestanding tub — client decision required", project: "Hawks Ridge Residence", owner: "Alex Carter", due: "Jul 24, 2026", status: "Waiting on client" },
  { action: "3 unpublished expenses ready for review", project: "Hawks Ridge Residence", owner: "Brent Leibee", due: "Jul 21, 2026", status: "Needs attention today" },
  { action: "Truss delivery confirmation", project: "Hawks Ridge Residence", owner: "Summit Framing Crew", due: "Jul 23, 2026", status: "Waiting on vendor" },
  { action: "Post jobsite update for the week", project: "Hawks Ridge Residence", owner: "Brent Leibee", due: "Jul 25, 2026", status: "Upcoming this week" },
];
