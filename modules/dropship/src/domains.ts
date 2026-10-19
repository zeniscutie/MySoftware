import { resolveNs } from "node:dns/promises";

/**
 * A quick look at whether a domain is in use: a domain with name servers is registered. No name servers does not
 * prove it's free (it may be registered and parked without DNS), so the answer is "taken" or "maybe free", never
 * "free". The owner checks at a registrar before buying.
 */

export type DomainStatus = "taken" | "maybe_free" | "unknown";
export type Resolver = (domain: string) => Promise<string[]>;

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export async function checkDomain(domain: string, resolver: Resolver = resolveNs, timeoutMs = 3000): Promise<DomainStatus> {
  if (!/^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(domain)) return "unknown";
  let timer: NodeJS.Timeout | undefined;
  try {
    const ns = await Promise.race([
      resolver(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
    return ns.length > 0 ? "taken" : "maybe_free";
  } catch (err) {
    return NOT_FOUND.has((err as { code?: string }).code ?? "") ? "maybe_free" : "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/** Checks several domains at once (at most 8 in flight). */
export async function checkDomains(domains: string[], resolver?: Resolver): Promise<Record<string, DomainStatus>> {
  const out: Record<string, DomainStatus> = {};
  const queue = [...new Set(domains.map((d) => d.toLowerCase()))];
  const worker = async () => {
    for (let d = queue.shift(); d !== undefined; d = queue.shift()) out[d] = await checkDomain(d, resolver);
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return out;
}
