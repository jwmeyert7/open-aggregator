"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Footer Admin link, visible only in browsers that have logged into the
 * admin. Keyed off the cosmetic oa_admin_ui cookie set at login: readable
 * from JS, grants nothing, real auth stays the httpOnly session cookie that
 * isAdmin() checks. Renders nothing on the server and before mount, so
 * visitors get zero output and hydration always matches.
 */
export function AdminLink() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(document.cookie.split("; ").includes("oa_admin_ui=1"));
  }, []);
  return show ? <Link href="/admin">Admin</Link> : null;
}
