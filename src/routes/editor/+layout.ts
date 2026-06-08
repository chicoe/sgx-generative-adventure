// The editor is a client-only SPA: it relies on the Firebase client SDK for
// auth + Firestore, so there's no benefit to SSR (and it avoids auth flicker).
export const ssr = false;
export const prerender = false;
