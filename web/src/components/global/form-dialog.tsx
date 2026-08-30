"use client";

// SOT: modal-dialog, sheet, confirm-dialog
// WHAT:  the app's single sheet shell, accessible by construction.
// WHY:   13 views open dialogs; hand-rolling focus traps in each would break WCAG.
//        DESIGN.md presents them as macOS sheets rather than centred web modals.
// HOW:   HeroUI Modal is built on React Aria, so focus trap, Escape and restore
//        come from the library rather than bespoke key handlers. The confirm button
//        sits trailing, as AppKit places the default button.
// WHERE: HeroUI API notes in web/HEROUI-API-NOTES.md

import { Alert, Button, Modal } from "@heroui/react";
import { useState, type ReactNode } from "react";
import { describeError } from "@/lib/api";
import { Icon, type IconName } from "@/components/global/icon";

export function FormDialog({
  isOpen, onClose, title, description, children, confirmLabel = "Save", onConfirm,
  size = "md", icon, tone = "default", cancelLabel = "Cancel",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => Promise<void>;
  size?: "sm" | "md" | "lg";
  /** Optional glyph in the sheet header, as macOS alerts show an app or state icon. */
  icon?: IconName;
  /** `danger` makes the confirm button destructive. */
  tone?: "default" | "danger";
  cancelLabel?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!onConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e: unknown) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open) { setError(null); onClose(); } }}>
      <Modal.Backdrop>
        <Modal.Container size={size}>
          <Modal.Dialog>
            <Modal.Header>
              <div className="flex items-start gap-3">
                {icon ? (
                  <span
                    className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-control ${
                      tone === "danger"
                        ? "bg-danger-soft text-danger"
                        : "bg-accent-soft text-accent"
                    }`}
                  >
                    <Icon name={icon} size={16} />
                  </span>
                ) : null}
                <div className="min-w-0">
                  <Modal.Heading className="text-title3 font-semibold tracking-[-0.01em]">
                    {title}
                  </Modal.Heading>
                  {description ? (
                    <p className="mt-0.5 text-footnote text-muted">{description}</p>
                  ) : null}
                </div>
              </div>
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-3.5">
              {error ? (
                <Alert status="danger">
                  <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
                </Alert>
              ) : null}
              {children}
            </Modal.Body>

            <Modal.Footer>
              <Button variant="outline" size="sm" onPress={onClose}>{cancelLabel}</Button>
              {onConfirm ? (
                <Button
                  variant={tone === "danger" ? "danger" : "primary"}
                  size="sm"
                  isPending={busy}
                  onPress={() => void confirm()}
                >
                  {confirmLabel}
                </Button>
              ) : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
