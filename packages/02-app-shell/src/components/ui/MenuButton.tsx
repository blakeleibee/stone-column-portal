"use client";

/**
 * MenuButton — a button that reveals a small dropdown of secondary
 * actions, for collapsing a row of loose buttons into one primary
 * action + a menu (the modernization plan's project-list requirement:
 * "secondary actions ... collapsed into a MenuButton, not a row of
 * equal-weight buttons").
 *
 * Keyboard-accessible by construction, not as an afterthought:
 *   - Escape closes the menu and returns focus to the trigger.
 *   - ArrowDown/ArrowUp move focus between items, wrapping around.
 *   - Opening (click, or Enter/Space/ArrowDown on the trigger) moves
 *     focus straight to the first item.
 *   - Tab closes the menu (real `<button>` items are already in the tab
 *     order while open; closing on Tab avoids leaving a stale open menu
 *     behind once focus moves elsewhere).
 *   - A `mousedown` listener on `document` closes the menu on any
 *     outside click.
 */
import React, { useEffect, useId, useRef, useState } from "react";

export interface MenuButtonItem {
  key: string;
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export interface MenuButtonProps {
  label: React.ReactNode;
  /** Real `aria-label` for the trigger `<button>`, for callers whose
   *  visible `label` isn't itself a legible accessible name (e.g. a
   *  glyph-only label like "⋯"). Optional — when omitted, the trigger
   *  falls back to its visible `label` content as its accessible name,
   *  exactly as before this prop existed. */
  ariaLabel?: string;
  items: MenuButtonItem[];
  align?: "start" | "end";
  className?: string;
}

export function MenuButton({ label, ariaLabel, items, align = "end", className }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    // Guards `typeof document` rather than assuming a browser: this
    // component only ever runs its effects client-side in production
    // (SSR never runs effects at all), but this package's own test
    // suite mounts client components with react-test-renderer directly
    // in plain Node — deliberately without jsdom (see
    // test/estimateTable_field_sync.tsx's header comment) — where
    // `document` is not defined at all. Without this guard, opening the
    // menu under that test harness would throw instead of exercising
    // the component's keyboard behavior.
    if (!open || typeof document === "undefined") return;
    function handleDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      itemRefs.current[0]?.focus();
    }
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleMenuItemKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndFocusTrigger();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = (index + 1) % items.length;
      itemRefs.current[next]?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (index - 1 + items.length) % items.length;
      itemRefs.current[prev]?.focus();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={["sc-ui-menu", className].filter(Boolean).join(" ")} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="sc-ui-menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        {label}
      </button>
      {open && (
        <div id={menuId} role="menu" className={`sc-ui-menu-list sc-ui-menu-list-${align}`}>
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className="sc-ui-menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                item.onClick();
              }}
              onKeyDown={(e) => handleMenuItemKeyDown(e, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
