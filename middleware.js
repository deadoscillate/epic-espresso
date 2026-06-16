// Edge Middleware: on the public deployment (APP_ROLE=public) the admin panel is
// hidden entirely — any request to /admin is redirected to the status board.
// On the admin deployment (APP_ROLE unset or "admin") it falls through and the
// admin page is served (still PIN-gated by the API). One codebase, two roles.
export const config = { matcher: ["/admin", "/admin/:path*"] };

export default function middleware(request) {
  if ((process.env.APP_ROLE || "all") === "public") {
    const url = new URL(request.url);
    url.pathname = "/";
    return Response.redirect(url, 307);
  }
}
