import type { Metadata } from "next";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Сброс пароля",
  description: "Обратитесь к администратору для сброса пароля.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordClient />;
}
