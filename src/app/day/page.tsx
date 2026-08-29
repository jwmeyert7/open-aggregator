import { redirect } from "next/navigation";

/** The daily index moved under the archive hub. Old links still land right. */
export default function DayIndexRedirect() {
  redirect("/archive/daily");
}
