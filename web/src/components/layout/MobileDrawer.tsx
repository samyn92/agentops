// MobileDrawer — swipe-to-open drawer for mobile devices
// CSS classes (mobile-drawer, mobile-drawer-backdrop) defined in index.css
import { Show, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
}

export default function MobileDrawer(props: MobileDrawerProps) {
  let drawerRef: HTMLDivElement | undefined;
  let startX = 0;
  let currentX = 0;

  function onTouchStart(e: TouchEvent) {
    startX = e.touches[0].clientX;
    currentX = startX;
  }

  function onTouchMove(e: TouchEvent) {
    currentX = e.touches[0].clientX;
    const delta = currentX - startX;

    // Only allow dragging closed (left)
    if (delta < 0 && drawerRef) {
      drawerRef.style.transform = `translateX(${delta}px)`;
    }
  }

  function onTouchEnd() {
    const delta = currentX - startX;

    if (drawerRef) {
      drawerRef.style.transform = '';
    }

    // Close if dragged more than 80px left
    if (delta < -80) {
      props.onClose();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        class={`mobile-drawer-backdrop ${props.open ? 'open' : ''}`}
        onClick={props.onClose}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        class={`mobile-drawer ${props.open ? 'open' : ''}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {props.children}
      </div>
    </>
  );
}
