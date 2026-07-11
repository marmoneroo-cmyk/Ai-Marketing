/**
 * Focus-trap helpers shared by every modal surface (the mobile `SidebarDrawer`
 * and the `CommandPalette`) so the tab-cycling logic lives in exactly one place
 * instead of being copy-pasted per dialog.
 */

/** Elements a keyboard user can land on — bounds a dialog's focus trap. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Keeps Tab/Shift+Tab cycling within `container` (wraps last->first, first->last). */
export function trapTabFocus(event: KeyboardEvent, container: HTMLElement | null): void {
  const focusable = getFocusableElements(container);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !container?.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !container?.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}
