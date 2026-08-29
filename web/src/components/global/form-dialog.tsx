"use client";

// SOT: modal-dialog, confirm-dialog
// WHAT:  the app's single modal shell, accessible by construction.
// WHY:   13 views open dialogs; hand-rolling focus traps in each would break WCAG.
// HOW:   HeroUI Modal is built on React Aria, so focus trap, Escape and restore
//        come from the library rather than bespoke key handlers.
// WHERE: HeroUI API notes in web/HEROUI-API-NOTES.md

import { Alert, Button, Modal } from "@heroui/react";
import { useState, type ReactNode } from "react";
import { describeError } from "@/lib/api";

export function FormDialog({
  isOpen, onClose, title, description, children, confirmLabel = "Save", onConfirm, size = "md",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => Promise<void>;
  size?: "sm" | "md" | "lg";
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
              <Modal.Heading>{title}</Modal.Heading>
              {description ? <p className="text-sm text-muted">{description}</p> : null}
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              {error ? (
                <Alert status="danger">
                  <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
                </Alert>
              ) : null}
              {children}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline" onPress={onClose}>Cancel</Button>
              {onConfirm ? (
                <Button variant="primary" isPending={busy} onPress={() => void confirm()}>
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
