// /commonworld/first: the first Commonworld, kept to visit after the new world began.
export const onRequest = ({ request }: { request: Request }): Response =>
  Response.redirect(new URL('/commonworld/?world=first', request.url).toString(), 302);
