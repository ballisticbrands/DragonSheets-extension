/** Tiny external store for sidebar open/closed state — lets the plain-DOM
 * launcher (which lives in Google's light DOM) drive the React app (which
 * lives in our shadow root) without coupling. */
type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

export const sidebarStore = {
  isOpen(): boolean {
    return open;
  },
  setOpen(value: boolean): void {
    if (open === value) return;
    open = value;
    listeners.forEach((l) => l());
  },
  toggle(): void {
    sidebarStore.setOpen(!open);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
