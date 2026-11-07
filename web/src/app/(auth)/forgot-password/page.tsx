import { redirect } from "next/navigation";

/**
 * The password reset now opens in the landing page's hero, in place of the
 * video. This address stays so bookmarks and older links still reach it.
 */
export default function ForgotPasswordPage() {
  redirect("/?view=forgot");
}
