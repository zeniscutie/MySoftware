import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineModule, moduleManifestSchema, type JobDefinition } from "@attentionos/core";
import { brandPackJob, contentPackJob } from "./jobs/launch.ts";
import { analyzeNewJob, analyzeProductJob, productHuntJob } from "./jobs/research.ts";
import { dailyDigestJob, storeReportJob, storeSyncJob, syncDecisionsJob } from "./jobs/store.ts";
import { dropshipSettingsSchema } from "./settings.ts";
import { tools } from "./tools/index.ts";

const manifest = moduleManifestSchema.parse(JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8")));

export const jobs = [
  productHuntJob, analyzeNewJob, analyzeProductJob, contentPackJob, brandPackJob, storeSyncJob, storeReportJob, syncDecisionsJob, dailyDigestJob,
] as unknown as JobDefinition[];

export default defineModule({
  manifest,
  settingsSchema: dropshipSettingsSchema,
  jobs,
  tools,
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  skillsDir: fileURLToPath(new URL("../skills", import.meta.url)),
});

// For Studio and tests.
export { dropshipSettings, dropshipSettingsSchema, effectiveRules, RULES_PRESETS, type DropshipSettings, type Rules } from "./settings.ts";
export { judgePerformance, profitFor, scoreProduct, type Performance, type ProductScore, type Profit } from "./scoring.ts";
export {
  addCandidate, assignProduct, countByStatus, createStore, saveAssets, getProduct, getStore, listAssets, listProducts, listStores, saveAnalysis,
  setAssetStatus, setProductStatus, startLaunch, syncDecisions, APPROVAL_SUBJECT, PRODUCT_STATUSES,
  type Asset, type AssetKind, type Product, type ProductStatus, type Store,
} from "./repo.ts";
export { storePerformance, syncStore, type ProductPerformance, type StorePerformance } from "./sync.ts";
export { composeDigest } from "./jobs/store.ts";
export type { BrandPack, ContentPack, ProductAnalysis, ScoutCandidate } from "./schemas.ts";
export { tools } from "./tools/index.ts";
