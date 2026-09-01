"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Wraps admin-only diagnostics (the ranking X-ray) so the footer's admin mode
 * checkbox shows and hides them together with the edit links. The server only
 * renders these children for a logged-in admin, so this is purely a display
 * toggle, never access control.
 */
export function AdminXray({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setShow(localStorage.getItem("editlinks") === "1");
      } catch {
        setShow(false);
      }
    };
    read();
    window.addEventListener("editlinks-pref", read);
    return () => window.removeEventListener("editlinks-pref", read);
  }, []);

  return show ? <>{children}</> : null;
}
