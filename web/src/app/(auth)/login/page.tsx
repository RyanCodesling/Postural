import { redirect } from "next/navigation";

/**
 * Log in now opens in the landing page's hero, in place of the video. This
 * address stays so bookmarks and older links still reach it.
 */
export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reset } = await searchParams;
  redirect(reset === "success" ? "/?view=login&reset=success" : "/?view=login");
}
