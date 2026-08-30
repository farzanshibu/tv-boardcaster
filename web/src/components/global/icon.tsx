"use client";

// SOT: iconography, icon-registry, sf-symbol-equivalents
// WHAT:  the app's only icon surface. One name -> one vector, one stroke family.
// WHY:   the previous build used emoji and geometric unicode glyphs ("▦", "⚙", "👥")
//        as icons. Those render differently on every platform, ignore font weight,
//        do not reliably inherit currentColor, and are announced by screen readers.
//        DESIGN.md bans them outright.
// HOW:   views import { Icon } and pass a typed `name`. Nothing outside this file
//        imports from @hugeicons/core-free-icons, so the set cannot drift and a
//        typo is a compile error rather than a blank square at runtime.
// WHERE: names catalogued in DESIGN.md > Iconography

import { HugeiconsIcon } from "@hugeicons/react";
import {
  // navigation (mirrors the resource registry in src/lib/resources.ts)
  DashboardSquare01Icon,
  ComputerIcon,
  Clock01Icon,
  Analytics01Icon,
  Image02Icon,
  PlayListIcon,
  Megaphone01Icon,
  Building03Icon,
  UserMultiple02Icon,
  CreditCardIcon,
  TaskDone01Icon,
  Settings01Icon,
  SparklesIcon,
  // actions
  Add01Icon,
  PencilEdit02Icon,
  Delete02Icon,
  Upload04Icon,
  CloudUploadIcon,
  Download04Icon,
  Link04Icon,
  LinkSquare02Icon,
  Unlink01Icon,
  RefreshIcon,
  ArrowTurnBackwardIcon,
  Rocket01Icon,
  Search01Icon,
  Logout03Icon,
  UserAdd02Icon,
  MailAdd01Icon,
  // status and feedback
  CheckmarkCircle02Icon,
  CheckmarkBadge01Icon,
  Tick02Icon,
  Alert02Icon,
  UnavailableIcon,
  InformationCircleIcon,
  Wifi01Icon,
  WifiDisconnected01Icon,
  Loading03Icon,
  ShieldKeyIcon,
  SecurityCheckIcon,
  // objects
  Video01Icon,
  Layers01Icon,
  TvSmartIcon,
  Location01Icon,
  Invoice01Icon,
  Money01Icon,
  Calendar03Icon,
  Time04Icon,
  FileValidationIcon,
  // chrome
  Cancel01Icon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  ArrowUpRight01Icon,
  ArrowExpandIcon,
  Menu01Icon,
  SidebarLeftIcon,
  DragDropVerticalIcon,
  MoreHorizontalIcon,
  Moon02Icon,
  Sun03Icon,
  ComputerDesk01Icon,
  GlobalIcon,
} from "@hugeicons/core-free-icons";

/* The registry. Keys are intent ("publish"), not appearance ("rocket"), so a view
   never has to know which glyph a concept maps to. */
const ICONS = {
  // sidebar / resources
  overview: DashboardSquare01Icon,
  screens: ComputerIcon,
  schedules: Clock01Icon,
  analytics: Analytics01Icon,
  media: Image02Icon,
  playlists: PlayListIcon,
  tickers: Megaphone01Icon,
  branches: Building03Icon,
  team: UserMultiple02Icon,
  billing: CreditCardIcon,
  audit: TaskDone01Icon,
  settings: Settings01Icon,
  platform: SparklesIcon,

  // actions
  add: Add01Icon,
  edit: PencilEdit02Icon,
  delete: Delete02Icon,
  upload: Upload04Icon,
  uploadCloud: CloudUploadIcon,
  download: Download04Icon,
  link: Link04Icon,
  external: LinkSquare02Icon,
  unpair: Unlink01Icon,
  refresh: RefreshIcon,
  rollback: ArrowTurnBackwardIcon,
  publish: Rocket01Icon,
  search: Search01Icon,
  signOut: Logout03Icon,
  invite: MailAdd01Icon,
  addUser: UserAdd02Icon,

  // status
  success: CheckmarkCircle02Icon,
  approved: CheckmarkBadge01Icon,
  check: Tick02Icon,
  warning: Alert02Icon,
  error: UnavailableIcon,
  info: InformationCircleIcon,
  online: Wifi01Icon,
  offline: WifiDisconnected01Icon,
  pending: Loading03Icon,
  security: ShieldKeyIcon,
  verified: SecurityCheckIcon,

  // objects
  video: Video01Icon,
  layers: Layers01Icon,
  tv: TvSmartIcon,
  location: Location01Icon,
  invoice: Invoice01Icon,
  money: Money01Icon,
  calendar: Calendar03Icon,
  time: Time04Icon,
  document: FileValidationIcon,

  // chrome
  close: Cancel01Icon,
  chevronRight: ArrowRight01Icon,
  chevronLeft: ArrowLeft01Icon,
  arrowUpRight: ArrowUpRight01Icon,
  expand: ArrowExpandIcon,
  menu: Menu01Icon,
  sidebar: SidebarLeftIcon,
  drag: DragDropVerticalIcon,
  more: MoreHorizontalIcon,
  appearanceDark: Moon02Icon,
  appearanceLight: Sun03Icon,
  appearanceSystem: ComputerDesk01Icon,
  language: GlobalIcon,
} as const;

/** Every icon the product may use, as a literal union. A typo fails the build. */
export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** Optical size in px. 16-20 uses a 1.5 stroke, 24+ uses 1.8 (DESIGN.md). */
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons; they become aria-hidden. */
  title?: string;
}

export function Icon({ name, size = 17, className, strokeWidth, title }: IconProps) {
  const stroke = strokeWidth ?? (size >= 24 ? 1.8 : 1.5);
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      size={size}
      strokeWidth={stroke}
      className={className ?? ""}
      // Decorative by default: text always carries the meaning (PRODUCT.md a11y).
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      focusable="false"
    />
  );
}

/**
 * Fixed-width icon box for source lists and table cells.
 * Glyph widths differ; the box keeps every label on the same optical baseline.
 */
export function IconSlot({ name, size = 17, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <span className={`inline-grid size-[18px] shrink-0 place-items-center ${className ?? ""}`}>
      <Icon name={name} size={size} />
    </span>
  );
}
