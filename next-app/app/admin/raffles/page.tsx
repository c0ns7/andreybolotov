import { redirect } from "next/navigation";

export default function AdminRafflesRedirectPage() {
  redirect("/admin?tab=raffles");
}
