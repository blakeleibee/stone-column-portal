"use client";

/**
 * Tabs — for the existing active/completed/archived
 * (`ProjectListWorkspace.tsx`'s `sc-projects-view-tabs`, real page
 * navigation via `<a href>`) and brief/site-info (in-page tab switch)
 * patterns. Each `TabItem` supports EITHER `href` (rendered as a real
 * link — the project-list case, where each "tab" is actually a distinct
 * route/view) OR `onClick` (rendered as a button — an in-page tab
 * switch), matching both existing patterns without forcing either one
 * into the other's shape.
 */
import React from "react";

export interface TabItem {
  key: string;
  label: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeKey: string;
  "aria-label"?: string;
  className?: string;
}

export function Tabs({ items, activeKey, className, ...rest }: TabsProps) {
  return (
    <div className={["sc-ui-tabs", className].filter(Boolean).join(" ")} role="tablist" {...rest}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        const classes = ["sc-ui-tab", isActive ? "sc-ui-tab-active" : ""].filter(Boolean).join(" ");

        if (item.href) {
          return (
            <a
              key={item.key}
              href={item.href}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              className={classes}
            >
              {item.label}
            </a>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={classes}
            onClick={item.onClick}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
