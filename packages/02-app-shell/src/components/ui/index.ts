// Barrel export for the shared UI primitive layer. Every file here is
// also independently importable directly (e.g.
// `import { Button } from ".../ui/Button"`) — this barrel is a
// convenience for callers that want several primitives at once, not a
// requirement.
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { TextInput } from "./TextInput";
export type { TextInputProps } from "./TextInput";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { Select } from "./Select";
export type { SelectProps } from "./Select";

export { Checkbox } from "./Checkbox";
export type { CheckboxProps } from "./Checkbox";

export { FormField } from "./FormField";
export type { FormFieldProps, FormControlProps } from "./FormField";

export { FormGrid } from "./FormGrid";
export type { FormGridProps } from "./FormGrid";

export { Card } from "./Card";
export type { CardProps } from "./Card";

export { PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";

export { Badge, StatusBadge } from "./Badge";
export type { BadgeProps, BadgeTone, StatusBadgeProps } from "./Badge";

export { Alert } from "./Alert";
export type { AlertProps, AlertTone } from "./Alert";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Tabs } from "./Tabs";
export type { TabsProps, TabItem } from "./Tabs";

export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

export { ChecklistItem } from "./ChecklistItem";
export type { ChecklistItemProps, ChecklistItemStatus } from "./ChecklistItem";

export { MenuButton } from "./MenuButton";
export type { MenuButtonProps, MenuButtonItem } from "./MenuButton";

export { uiStyles } from "./styles";
