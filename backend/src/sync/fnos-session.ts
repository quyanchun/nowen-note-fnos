/** Desktop-only bridge to the NAS browser session held by Electron main. */
export const fetchFnosSession: typeof fetch = async (input, init) => {
  const address = process.env.NOWEN_FNOS_BRIDGE_URL;
  const capability = process.env.NOWEN_FNOS_BRIDGE_TOKEN;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address || "") || !capability) throw new Error("Native NAS session unavailable");
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers);
  headers.set("X-Nowen-Bridge", capability);
  headers.set("X-Nowen-Target", target);
  return fetch(address!, { ...init, headers, redirect: "error" });
};
