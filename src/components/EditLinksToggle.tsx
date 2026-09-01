"use client";

import { useEffect, useState } from "react";

/**
 * Footer opt-in for the admin's on-page edit links, shown only in a browser
 * that has visited the admin (the cosmetic oa_admin_ui cookie). Off by
 * default so screenshots always look exactly like the public site; the links
 * themselves live behind the same gate, and the admin pages still require a
 * login, so this is display preference, never access.
 */
export function EditLinksToggle() {
  const [admin, setAdmin] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    setAdmin(document.cookie.includes("oa_admin_ui=1"));
    try {
      setOn(localStorage.getItem("editlinks") === "1");
    } catch {}
  }, []);

  if (!admin) return null;

  return (
    <label className="footer-pref">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          try {
            localStorage.setItem("editlinks", e.target.checked ? "1" : "0");
          } catch {}
          window.dispatchEvent(new Event("editlinks-pref"));
        }}
      />{" "}
      admin mode
    </label>
  );
}
