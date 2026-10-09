import { afterEach, describe, expect, it } from "vitest";
import { getRepository, RepositoryConfigurationError, resetRepositoryForTests } from "@/lib/repository";

const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, demo: process.env.FORGEOPS_DEMO_MODE };
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url; process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key; process.env.FORGEOPS_DEMO_MODE = previous.demo; resetRepositoryForTests(); });

describe("repository selection", () => {
  it("requires explicit demo mode when no database exists", () => { delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.FORGEOPS_DEMO_MODE = "true"; expect(getRepository()).toBeDefined(); });
  it("does not silently use demo data for incomplete database configuration", () => { process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"; delete process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.FORGEOPS_DEMO_MODE = "true"; expect(() => getRepository()).toThrow(RepositoryConfigurationError); });
});
