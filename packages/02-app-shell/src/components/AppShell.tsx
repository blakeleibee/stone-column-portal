"use client";

import React, { useState, useRef, useEffect } from "react";
import { colors, spacing, radius, typography, touchTarget, shadow } from "../design/tokens";
import { AppRole, NavItem, navForRole, clientMoreNav } from "../nav/navigation";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { Button } from "./ui/Button";
import { uiStyles } from "./ui/styles";
import type { ProjectRow } from "../services/projectService";

const LOGO_SRC = "/assets/logo.jpg";

/**
 * VISUAL RESTORATION NOTE: colors/logo/layout below were brought back
 * in line with the original Phase 1 prototype (dark ink sidebar, real
 * supplied logo image, sage/gold/brick accents) per explicit direction
 * that the original prototype is the visual/content baseline. Nothing
 * about this component's PROPS, behavior, security posture, or the
 * client-preview safeguards changed — role, activeKey, onNavigate,
 * isPreviewingAsClient/onExitPreview, and the mobile drawer/More-sheet
 * logic (including the test-only initialDrawerOpen/initialMoreSheetOpen
 * props) are byte-for-byte the same contract as before this restyle.
 */
function IconPlaceholder({ name }: { name: string }) {
  const letter = name.charAt(0);
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "20px",
        height: "20px",
        borderRadius: radius.pill,
        background: "rgba(255,255,255,0.12)",
        color: colors.paper,
        fontSize: "10px",
        fontWeight: typography.weightBold,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

/**
 * Task 4: the data + mutation ProjectSwitcher needs, threaded through as
 * one optional prop bundle rather than several loose ones. Optional
 * (not required) so every existing caller/test that doesn't supply it
 * (render_smoke.tsx, ClientChrome.tsx) keeps rendering exactly as
 * before — the header simply falls back to the old plain `projectName`
 * text when this is absent. When present, it REPLACES that plain text
 * (ProjectSwitcher itself shows the current project's name + badge), so
 * a caller should pass one or the other, not rely on both rendering
 * together.
 */
export interface AppShellProjectSwitcherProps {
  currentProject: ProjectRow | null;
  otherProjects: ProjectRow[];
  hasArchivedProjects: boolean;
  onSwitch: (projectId: string) => Promise<{ id: string } | { error: string }>;
  isAdmin: boolean;
  allProjectsHref: string;
  completedProjectsHref: string;
  archivedProjectsHref: string;
  createProjectHref: string;
}

export interface AppShellProps {
  role: AppRole;
  activeKey: string;
  onNavigate: (key: string) => void;
  userName: string;
  projectName?: string;
  projectSwitcher?: AppShellProjectSwitcherProps;
  isPreviewingAsClient?: boolean;
  onExitPreview?: () => void;
  children: React.ReactNode;
  initialDrawerOpen?: boolean;
  initialMoreSheetOpen?: boolean;
}

export function AppShell({
  role,
  activeKey,
  onNavigate,
  userName,
  projectName,
  projectSwitcher,
  isPreviewingAsClient,
  onExitPreview,
  children,
  initialDrawerOpen,
  initialMoreSheetOpen,
}: AppShellProps) {
  const items = navForRole(role);
  const isClientNav = role === "client";

  const [isDrawerOpen, setDrawerOpen] = useState(Boolean(initialDrawerOpen));
  const [isMoreSheetOpen, setMoreSheetOpen] = useState(Boolean(initialMoreSheetOpen));
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreCloseRef = useRef<HTMLButtonElement>(null);

  function openDrawer() {
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
    menuTriggerRef.current?.focus();
  }
  function openMoreSheet() {
    setMoreSheetOpen(true);
  }
  function closeMoreSheet() {
    setMoreSheetOpen(false);
    moreTriggerRef.current?.focus();
  }

  useEffect(() => {
    if (isDrawerOpen) drawerCloseRef.current?.focus();
  }, [isDrawerOpen]);
  useEffect(() => {
    if (isMoreSheetOpen) moreCloseRef.current?.focus();
  }, [isMoreSheetOpen]);

  function handleOverlayKeyDown(e: React.KeyboardEvent, close: () => void) {
    if (e.key === "Escape") close();
  }

  function handleNavigate(key: string) {
    onNavigate(key);
    setDrawerOpen(false);
    setMoreSheetOpen(false);
  }

  return (
    <div className="sc-shell" data-role={role}>
      {isPreviewingAsClient && (
        <div className="sc-preview-banner">
          <span className="sc-preview-banner-text">
            <span className="sc-preview-banner-short">Client preview</span>
            <span className="sc-preview-banner-long"> — Exit preview to return to your admin view.</span>
          </span>
          <Button
            className="sc-preview-exit"
            variant="secondary"
            size="sm"
            onClick={onExitPreview}
          >
            Exit preview
          </Button>
        </div>
      )}

      <header className="sc-topbar">
        <div className="sc-topbar-brand">
          {projectSwitcher ? (
            <ProjectSwitcher {...projectSwitcher} />
          ) : (
            projectName && <span className="sc-topbar-project">{projectName}</span>
          )}
        </div>
        <div className="sc-topbar-user">
          {role === "admin" && !isPreviewingAsClient ? (
            <span className="sc-topbar-preview-hint">Viewing as Admin</span>
          ) : isClientNav ? (
            <span>Signed in as {userName}</span>
          ) : (
            <span>{userName}</span>
          )}
        </div>
        <button
          ref={menuTriggerRef}
          className="sc-topbar-menu-trigger"
          aria-label="Open navigation menu"
          aria-haspopup="true"
          aria-expanded={isDrawerOpen}
          onClick={openDrawer}
        >
          <span style={{ color: colors.ink, fontSize: 18 }}>≡</span>
        </button>
      </header>

      <div className="sc-body">
        <nav className="sc-sidebar" aria-label="Primary">
          <div className="sc-sidebar-brand">
            <img src={LOGO_SRC} alt="Stone Column Custom Homes & Remodeling" className="sc-sidebar-logo" />
            <div className="sc-sidebar-brand-label">{role === "client" ? "Homeowner Portal" : "Admin Portal"}</div>
          </div>
          <div className="sc-sidebar-nav">
            {renderNavGroups(items, activeKey, handleNavigate)}
          </div>
        </nav>

        <main className="sc-content">{children}</main>
      </div>

      {isClientNav && (
        <nav className="sc-bottom-nav" aria-label="Primary">
          {items.map((item) => (
            <NavButton key={item.key} item={item} active={item.key === activeKey} onNavigate={handleNavigate} vertical={false} />
          ))}
          <button
            ref={moreTriggerRef}
            className="sc-nav-item sc-nav-item--horizontal"
            aria-haspopup="true"
            aria-expanded={isMoreSheetOpen}
            onClick={openMoreSheet}
          >
            <IconPlaceholderDark name="More" />
            <span>More</span>
          </button>
        </nav>
      )}

      {isDrawerOpen && (
        <div
          className="sc-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          onKeyDown={(e) => handleOverlayKeyDown(e, closeDrawer)}
        >
          <div className="sc-overlay-backdrop" onClick={closeDrawer} />
          <div className="sc-drawer">
            <div className="sc-drawer-brand">
              <img src={LOGO_SRC} alt="Stone Column Custom Homes & Remodeling" className="sc-sidebar-logo" />
            </div>
            <div className="sc-overlay-head">
              <span>Menu</span>
              <button ref={drawerCloseRef} className="sc-overlay-close" onClick={closeDrawer} aria-label="Close menu">
                ×
              </button>
            </div>
            {renderNavGroups(items, activeKey, handleNavigate)}
          </div>
        </div>
      )}

      {isMoreSheetOpen && (
        <div
          className="sc-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="More"
          onKeyDown={(e) => handleOverlayKeyDown(e, closeMoreSheet)}
        >
          <div className="sc-overlay-backdrop" onClick={closeMoreSheet} />
          <div className="sc-sheet">
            <div className="sc-overlay-head">
              <span>More</span>
              <button ref={moreCloseRef} className="sc-overlay-close" onClick={closeMoreSheet} aria-label="Close">
                ×
              </button>
            </div>
            {clientMoreNav.map((item) => (
              <NavButtonLight key={item.key} item={item} active={item.key === activeKey} onNavigate={handleNavigate} />
            ))}
          </div>
        </div>
      )}

      {/* dangerouslySetInnerHTML, not <style>{shellStyles}</style> — the
          same hydration-mismatch class found and fixed in
          BidPackageWorkspace.tsx (commit 565a615): shellStyles
          interpolates typography.fontFamily, which contains literal
          apostrophes ('Inter', 'Segoe UI'), and React's plain-children
          <style> text escaping differs between server and client render
          for that content. This was a latent, not-yet-reported instance
          of the exact same bug in this exact file, fixed here while
          already touching AppShell.tsx for Task 4. */}
      <style dangerouslySetInnerHTML={{ __html: shellStyles }} />

      {/* Application-wide visual modernization: the shared ui/ primitive
          layer's stylesheet (Button, TextInput, FormField, Card, Badge,
          MenuButton, ...), injected here because AppShell is the one
          component every authenticated screen renders inside — this is
          genuinely "once per page load," not once per component
          instance, since AppShell itself is only ever mounted once per
          page (it's the outermost wrapper every route renders through —
          `apps/web/src/shell/AdminChrome.tsx` and `ClientChrome.tsx`,
          the only two places in this repo that mount <AppShell>, each
          render exactly one <AppShell> per page, never nested or
          repeated within a single render tree).

          Deliberately a SEPARATE <style> tag from shellStyles above,
          not merged into one combined string:
            - Smaller, safer diff — this task's only sanctioned edit to
              an existing file is adding this one block; folding
              shellStyles and uiStyles together would mean rewriting a
              working, already-tested string instead of appending next
              to it.
            - Different lifecycles/ownership: shellStyles is this file's
              own chrome (topbar/sidebar/drawer/nav) and changes only
              when AppShell.tsx itself changes; uiStyles is the new
              primitive layer, versioned and edited independently in
              ui/styles.ts as primitives are added in later phases.
              Keeping them separate means a future ui/ change never
              risks re-triggering the exact fontFamily-apostrophe
              hydration hazard the comment above this block documents by
              re-touching shellStyles' own interpolation.
            - Same dangerouslySetInnerHTML pattern as shellStyles (never
              a raw <style>{...}</style> JSX child) for the identical
              reason: uiStyles also interpolates typography.fontFamily. */}
      <style dangerouslySetInnerHTML={{ __html: uiStyles }} />
    </div>
  );
}

function IconPlaceholderDark({ name }: { name: string }) {
  const letter = name.charAt(0);
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "18px",
        height: "18px",
        borderRadius: radius.pill,
        background: colors.paperDim,
        color: colors.stoneDark,
        fontSize: "9px",
        fontWeight: typography.weightBold,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

/**
 * Pre-Task-10 owner-preview correction: groups admin/staff nav items into
 * "Organization" / "Current Project" sections when the config supplies
 * `section` (adminNav does; clientNav/projectTabs/clientMoreNav don't).
 * Falls back to the original flat, unheaded list otherwise — this is the
 * same items array, same NavButton, same onNavigate wiring as before;
 * only the grouping/heading presentation changes.
 */
function renderNavGroups(items: NavItem[], activeKey: string, onNavigate: (key: string) => void) {
  if (!items.some((item) => item.section)) {
    return items.map((item) => (
      <NavButton key={item.key} item={item} active={item.key === activeKey} onNavigate={onNavigate} vertical />
    ));
  }

  const sections: Array<{ id: "organization" | "project"; label: string }> = [
    { id: "organization", label: "Organization" },
    { id: "project", label: "Current Project" },
  ];

  return sections.flatMap(({ id, label }) => {
    const sectionItems = items.filter((item) => item.section === id);
    if (sectionItems.length === 0) return [];
    return [
      <div key={`heading-${id}`} className="sc-nav-section-heading">
        {label}
      </div>,
      ...sectionItems.map((item) => (
        <NavButton key={item.key} item={item} active={item.key === activeKey} onNavigate={onNavigate} vertical />
      )),
    ];
  });
}

function NavButton({
  item,
  active,
  onNavigate,
  vertical,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (key: string) => void;
  vertical: boolean;
}) {
  return (
    <button
      className={`sc-nav-item ${vertical ? "sc-nav-item--vertical" : "sc-nav-item--horizontal"}`}
      aria-current={active ? "page" : undefined}
      data-active={active}
      onClick={() => onNavigate(item.key)}
    >
      {vertical ? null : <IconPlaceholderDark name={item.icon} />}
      <span>{item.label}</span>
    </button>
  );
}

/** Used only inside the (light-background) More sheet, where the dark-
 *  sidebar nav button styling would have the wrong contrast. */
function NavButtonLight({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: (key: string) => void }) {
  return (
    <button className="sc-nav-item sc-nav-item--light" aria-current={active ? "page" : undefined} data-active={active} onClick={() => onNavigate(item.key)}>
      <IconPlaceholderDark name={item.icon} />
      <span>{item.label}</span>
    </button>
  );
}

const shellStyles = `
.sc-shell { font-family: ${typography.fontFamily}; color: ${colors.ink2}; background: ${colors.paper}; min-height: 100vh; display: flex; flex-direction: column; }

.sc-preview-banner { background: ${colors.goldTint}; color: ${colors.gold}; padding: 8px ${spacing.md}; display: flex; justify-content: space-between; align-items: center; gap: ${spacing.sm}; font-size: ${typography.sizeSm}; border-bottom: 1px solid ${colors.gold}; }
.sc-preview-banner-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: ${typography.weightMedium}; }
.sc-preview-banner-long { display: none; }
.sc-preview-exit { flex-shrink: 0; }

.sc-topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid ${colors.line}; background: ${colors.white}; box-shadow: ${shadow.sm}; position: relative; z-index: 5; }
.sc-topbar-project { font-size: ${typography.sizeSm}; color: ${colors.ink2}; }
.sc-topbar-user { font-size: 11.5px; color: ${colors.stoneDark}; display: none; }
.sc-topbar-preview-hint { color: ${colors.stoneDark}; }
.sc-topbar-menu-trigger { display: inline-flex; min-width: ${touchTarget.minSize}; min-height: ${touchTarget.minSize}; align-items: center; justify-content: center; background: none; border: none; border-radius: ${radius.sm}; transition: background-color 0.15s ease; }
.sc-topbar-menu-trigger:hover { background: ${colors.paperDim}; }
.sc-topbar-menu-trigger:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: -2px; }

.sc-body { display: flex; flex: 1; min-width: 0; }
.sc-content { flex: 1; min-width: 0; padding: 20px; padding-bottom: 80px; max-width: 1180px; }

.sc-sidebar { display: none; }

.sc-nav-item { display: flex; align-items: center; gap: ${spacing.sm}; min-height: ${touchTarget.minSize}; padding: 0 10px; background: none; border: none; border-radius: 6px; color: #B7BAC0; font-size: ${typography.sizeSm}; text-align: left; font-weight: 500; box-shadow: inset 0 0 0 0 ${colors.gold}; transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease; }
.sc-nav-item:hover:not([data-active="true"]) { background: rgba(255,255,255,0.06); color: ${colors.white}; }
.sc-nav-item[data-active="true"] { background: ${colors.inkSoft}; color: ${colors.white}; font-weight: 600; box-shadow: inset 3px 0 0 0 ${colors.gold}; }
.sc-nav-item:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: -2px; }
.sc-nav-item--vertical { width: 100%; margin-bottom: 2px; }
.sc-nav-section-heading { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${colors.stone}; padding: ${spacing.sm} 10px 4px; margin-top: 4px; }
.sc-nav-section-heading:first-child { margin-top: 0; }
.sc-nav-item--light { color: ${colors.ink2}; }
.sc-nav-item--light:hover:not([data-active="true"]) { background: ${colors.paperDim}; color: ${colors.ink}; }
.sc-nav-item--light[data-active="true"] { background: ${colors.sageTint}; color: ${colors.sageDeep}; box-shadow: inset 3px 0 0 0 ${colors.sage}; }

.sc-bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-around; background: ${colors.white}; border-top: 1px solid ${colors.line}; box-shadow: 0 -2px 8px rgba(34,38,43,0.06); padding: 4px 0; z-index: 10; }
.sc-nav-item--horizontal { flex-direction: column; gap: 2px; min-width: ${touchTarget.minSize}; font-size: 10.5px; background: none; border: none; color: ${colors.stoneDark}; box-shadow: none; }
.sc-nav-item--horizontal:hover:not([data-active="true"]) { color: ${colors.ink2}; background: none; }
.sc-nav-item--horizontal[data-active="true"] { color: ${colors.sageDeep}; background: none; font-weight: 600; box-shadow: none; }
.sc-nav-item--horizontal:focus-visible { outline-offset: -1px; }

.sc-overlay { position: fixed; inset: 0; z-index: 50; display: flex; }
.sc-overlay-backdrop { position: absolute; inset: 0; background: rgba(34,38,43,0.5); }
.sc-drawer { position: relative; width: 240px; max-width: 82vw; background: ${colors.ink}; height: 100%; padding: 18px 12px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; box-shadow: ${shadow.lg}; }
.sc-drawer-brand { padding: 0 6px 14px; }
.sc-sheet { position: relative; margin-top: auto; width: 100%; background: ${colors.white}; border-radius: ${radius.lg} ${radius.lg} 0 0; padding: ${spacing.md}; display: flex; flex-direction: column; gap: 2px; box-shadow: ${shadow.lg}; }
.sc-overlay-head { display: flex; justify-content: space-between; align-items: center; padding: 0 6px ${spacing.sm}; font-weight: ${typography.weightSemibold}; color: ${colors.paper}; }
.sc-sheet .sc-overlay-head { color: ${colors.ink}; }
.sc-overlay-close { background: none; border: none; border-radius: ${radius.sm}; font-size: 20px; min-width: ${touchTarget.minSize}; min-height: ${touchTarget.minSize}; color: inherit; transition: background-color 0.15s ease; }
.sc-overlay-close:hover { background: rgba(255,255,255,0.08); }
.sc-sheet .sc-overlay-close:hover { background: ${colors.paperDim}; }
.sc-overlay-close:focus-visible { outline: 2px solid ${colors.focusRing}; outline-offset: -2px; }

.sc-sidebar-brand { padding: 0 6px 18px; border-bottom: 1px solid ${colors.inkSoft}; margin-bottom: 14px; }
.sc-sidebar-logo { width: 100%; height: auto; display: block; margin-bottom: 10px; border-radius: 4px; }
.sc-sidebar-brand-label { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; text-align: center; color: ${colors.stone}; }

@media (min-width: 768px) {
  .sc-topbar-user { display: inline; }
  .sc-topbar-menu-trigger { display: none; }
  .sc-topbar { padding: 14px 32px; }
  .sc-preview-banner-long { display: inline; }
  .sc-sidebar { display: flex; flex-direction: column; width: 228px; flex-shrink: 0; padding: 22px 16px; background: ${colors.ink}; border-right: 1px solid ${colors.inkSoft}; }
  .sc-sidebar-nav { flex: 1; }
  .sc-content { padding: 28px 32px 60px; }
  .sc-bottom-nav { display: none; }
}
`;
