"use client";

import { useEffect, useState } from "react";

/**
 * The admin's one-click jump from a story card or podcast row to its admin
 * entry. Renders nothing unless this browser has the admin cookie AND the
 * footer's edit links toggle is on, so the public site (and any screenshot
 * of it) stays pixel-identical by default.
 */
export function AdminEditLink({ href }: { href: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setShow(document.cookie.includes("oa_admin_ui=1") && localStorage.getItem("editlinks") === "1");
      } catch {
        setShow(false);
      }
    };
    read();
    window.addEventListener("editlinks-pref", read);
    return () => window.removeEventListener("editlinks-pref", read);
  }, []);

  if (!show) return null;
  return (
    <a href={href} className="edit-link" title="Open this in the admin">
      edit
    </a>
  );
}
