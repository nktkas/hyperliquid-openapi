// deno-lint-ignore-file no-explicit-any

// ======================================================================================
// Schemas Extraction
// ======================================================================================

import * as hl from "@nktkas/hyperliquid";
import * as hlInfo from "@nktkas/hyperliquid/api/info";
import * as hlExchange from "@nktkas/hyperliquid/api/exchange";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { type ConversionConfig, type JSONSchema7, toJsonSchema } from "@valibot/to-json-schema";

type Endpoint = "info" | "exchange";

type AllSchemas = Record<Endpoint, Record<string, { request: JSONSchema7; response: JSONSchema7 }>>;

export function getAllSchemas(): AllSchemas {
  console.log("[Schemas] Starting to extract schemas...");

  // Configurations
  const endpoints = ["info", "exchange"] as const;
  const skippedMethods = ["multiSig"];
  const toJsonConfig: ConversionConfig = {
    errorMode: "ignore",
    typeMode: "output",
    overrideSchema: ({ jsonSchema }) => {
      if ("default" in jsonSchema) {
        delete jsonSchema.default;
      }
      return undefined;
    },
  };

  // Iterate over each endpoint
  const results: AllSchemas = { info: {}, exchange: {} };
  for (const endpoint of endpoints) {
    // Select appropriate API module
    const api = endpoint === "info" ? hlInfo : hlExchange;

    // Extract methods for the SDK client
    const methods = getAllMethodsFromClient(endpoint);

    // Iterate over each method
    for (const method of methods) {
      // Skip specified methods
      if (skippedMethods.includes(method)) continue;

      // Convert valibot schemas to JSON Schemas
      const upperMethod = replaceFirstCharToUpperCase(method);

      const RequestVSchemas = api[upperMethod + "Request" as keyof typeof api] as any;
      const RequestJSchema = toJsonSchema(RequestVSchemas, toJsonConfig);

      const ResponseVSchemas = api[upperMethod + "Response" as keyof typeof api] as any;
      const ResponseJSchema = toJsonSchema(ResponseVSchemas, toJsonConfig);

      results[endpoint][method] = { request: RequestJSchema, response: ResponseJSchema };
    }
  }

  console.log("[Schemas] Completed extraction of schemas.");

  return results;
}

function getAllMethodsFromClient(endpoint: Endpoint | "subscriptions"): string[] {
  let client: hl.InfoClient | hl.ExchangeClient | hl.SubscriptionClient;

  // Create appropriate client instance to extract method names
  if (endpoint === "info") {
    client = new hl.InfoClient({ transport: {} as hl.HttpTransport });
  } else if (endpoint === "exchange") {
    client = new hl.ExchangeClient({ transport: {} as hl.HttpTransport, wallet: {} as AbstractWallet });
  } else {
    client = new hl.SubscriptionClient({ transport: {} as hl.WebSocketTransport });
  }

  // Extract method names from client prototype, excluding constructor
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    .filter((name) => name !== "constructor" && typeof client[name as keyof typeof client] === "function");

  return methods;
}

function replaceFirstCharToUpperCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ======================================================================================
// JSON Schemas To OpenAPIs
// ======================================================================================

import { convert } from "@openapi-contrib/json-schema-to-openapi-schema";

type OpenAPISpecs = Record<Endpoint, Record<string, unknown>>;

export async function jsonSchemasToOpenAPIs(schemas: AllSchemas): Promise<OpenAPISpecs> {
  console.log("[OpenAPI] Converting JSON schemas to OpenAPI specs...");
  const result: OpenAPISpecs = { info: {}, exchange: {} };

  // Iterate over each endpoint and method
  for (const endpoint of Object.keys(schemas) as (keyof AllSchemas)[]) {
    for (const method of Object.keys(schemas[endpoint]) as (keyof typeof schemas[typeof endpoint])[]) {
      const { request, response } = schemas[endpoint][method];

      // Convert JSON Schemas to OpenAPI Schemas
      const openapiRequest = await convert(request);
      const openapiResponse = await convert(response);

      // Build OpenAPI spec for the method
      const spec = {
        openapi: "3.1.1",
        info: {
          title: `Hyperliquid API - ${endpoint}/${method}`,
          version: "1.0.0",
        },
        servers: [
          { url: "https://api.hyperliquid.xyz", description: "Mainnet" },
          { url: "https://api.hyperliquid-testnet.xyz", description: "Testnet" },
        ],
        tags: [{
          name: method,
          "x-page-title": method,
          "x-page-slug": method,
        }],
        paths: {
          [`/${endpoint}`]: {
            post: {
              tags: [method],
              description: request.description || "",
              requestBody: {
                content: { "application/json": { schema: openapiRequest } },
                required: true,
              },
              responses: {
                "200": {
                  description: response?.description || "",
                  content: { "application/json": { schema: openapiResponse } },
                },
                "422": {
                  description: "Failed to deserialize the JSON body into the target type",
                  content: { "text/plain": { schema: { type: "string" } } },
                },
                ...(endpoint === "info"
                  ? {
                    "500": {
                      description: "Internal Server Error",
                      content: { "application/json": { schema: { type: "null" } } },
                    },
                  }
                  : {}),
              },
            },
          },
        },
      };

      // Store the spec
      result[endpoint][method] = spec;
    }
  }

  const converted = Object.values(result).reduce((sum, endpoint) => sum + Object.keys(endpoint).length, 0);
  console.log(`[OpenAPI] Completed: ${converted} specs converted`);
  return result;
}

// ======================================================================================
// Update SUMMARY.md
// ======================================================================================

export async function updateSummary(openapiSpecs: OpenAPISpecs): Promise<void> {
  console.log("[Summary] Updating SUMMARY.md...");
  const summaryPath = new URL("./SUMMARY.md", import.meta.url);
  const summary = await Deno.readTextFile(summaryPath);

  // Find ## API section boundaries
  const apiHeader = "## API";
  const start = summary.indexOf(apiHeader);
  if (start === -1) throw new Error("Section ## API not found in SUMMARY.md");

  const nextHeaderIndex = summary.indexOf("\n## ", start + apiHeader.length);
  const prefix = summary.slice(0, start);
  const suffix = nextHeaderIndex === -1 ? "" : summary.slice(nextHeaderIndex);

  // Build API section content
  const lines = ["## API", ""];
  for (const section of Object.keys(openapiSpecs).sort() as Endpoint[]) {
    const methods = Object.keys(openapiSpecs[section]).sort();
    if (!methods.length) continue;

    lines.push(`- ${section.charAt(0).toUpperCase() + section.slice(1)}`);
    for (const method of methods) {
      lines.push(
        "  - ```yaml",
        "    type: builtin:openapi",
        "    props:",
        "      models: false",
        "      downloadLink: false",
        "    dependencies:",
        "      spec:",
        "        ref:",
        "          kind: openapi",
        `          spec: hl-${section}-${method}`,
        "    ```",
      );
    }
    lines.push("");
  }
  lines.push("");

  await Deno.writeTextFile(summaryPath, `${prefix}${lines.join("\n")}${suffix}`.trimEnd() + "\n");
  const totalMethods = Object.values(openapiSpecs).reduce((sum, endpoint) => sum + Object.keys(endpoint).length, 0);
  console.log(`[Summary] Updated with ${totalMethods} methods`);
}

// ======================================================================================
// Update GitBook OpenAPI Specs
// ======================================================================================

export async function updateGitBookOpenAPIs(
  openapiSpecs: OpenAPISpecs,
  gitbookToken: string,
  orgId: string,
): Promise<void> {
  console.log("[GitBook] Starting GitBook OpenAPI sync...");
  const apiBase = "https://api.gitbook.com/v1";
  const headers = {
    Authorization: `Bearer ${gitbookToken}`,
    "Content-Type": "application/json",
  };

  // Collect local specs with slugs
  const specs = Object.entries(openapiSpecs)
    .flatMap(([section, methods]) =>
      Object.entries(methods).map(([name, spec]) => ({
        slug: `hl-${section}-${name}`,
        text: JSON.stringify(spec),
      }))
    )
    .sort((a, b) => a.slug.localeCompare(b.slug));

  console.log(`[GitBook] Prepared ${specs.length} local specs`);
  if (specs.length === 0) {
    console.log("[GitBook] No specs to upload.");
    return;
  }

  const localSlugs = new Set(specs.map((s) => s.slug));

  // Fetch existing GitBook OpenAPI specs with pagination
  console.log("[GitBook] Fetching existing specs from GitBook...");
  const allRemoteSpecs: Array<{ slug: string }> = [];
  let nextPage: string | undefined;
  let pageCount = 0;

  do {
    pageCount++;
    const url = new URL(`${apiBase}/orgs/${orgId}/openapi`);
    url.searchParams.set("limit", "1000");
    if (nextPage) url.searchParams.set("page", nextPage);

    const listRes = await fetch(url.toString(), { headers });
    if (!listRes.ok) {
      const body = await listRes.text();
      throw new Error(`Failed to list GitBook specs (${listRes.status}): ${body}`);
    }

    const data = await listRes.json();

    allRemoteSpecs.push(...data.items);
    nextPage = data.next?.page;
  } while (nextPage);

  const remoteSlugs = allRemoteSpecs
    .map((item) => item.slug)
    .filter((slug) => slug.startsWith("hl-"));
  console.log(`[GitBook] Fetched ${remoteSlugs.length} existing specs from GitBook over ${pageCount} page(s)`);

  // Delete obsolete specs
  const toDelete = remoteSlugs.filter((slug) => !localSlugs.has(slug));
  if (toDelete.length > 0) {
    console.log(`[GitBook] Deleting ${toDelete.length} obsolete spec(s)...`);
  }
  for (const slug of remoteSlugs) {
    if (!localSlugs.has(slug)) {
      const delRes = await fetch(`${apiBase}/orgs/${orgId}/openapi/${slug}`, {
        method: "DELETE",
        headers,
      });

      if (!delRes.ok) {
        const body = await delRes.text();
        throw new Error(`Delete failed for ${slug} (${delRes.status}): ${body}`);
      }

      console.log(`[GitBook] Deleted ${slug}`);
    }
  }

  // Upload/update specs
  const toUpdate = specs.filter((s) => remoteSlugs.includes(s.slug));
  const toCreate = specs.filter((s) => !remoteSlugs.includes(s.slug));
  console.log(`[GitBook] Uploading ${toCreate.length} new, updating ${toUpdate.length} existing spec(s)...`);

  for (const { slug, text } of specs) {
    const isUpdate = remoteSlugs.includes(slug);
    const res = await fetch(`${apiBase}/orgs/${orgId}/openapi/${slug}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ source: { text } }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${isUpdate ? "Update" : "Upload"} failed for ${slug} (${res.status}): ${body}`);
    }

    console.log(`[GitBook] ${isUpdate ? "Updated" : "Uploaded"} ${slug}`);
  }

  console.log(`[GitBook] Sync completed`);
}

// ======================================================================================
// Main
// ======================================================================================

import "@std/dotenv/load";

if (import.meta.main) {
  console.log("==".repeat(40));
  console.log("Starting Hyperliquid OpenAPI Update Process");
  console.log("==".repeat(40));

  const GITBOOK_TOKEN = Deno.env.get("GITBOOK_TOKEN");
  const GITBOOK_ORG_ID = Deno.env.get("GITBOOK_ORG_ID");

  if (!GITBOOK_TOKEN || !GITBOOK_ORG_ID) {
    throw new Error("GITBOOK_TOKEN and GITBOOK_ORG_ID must be set in environment variables.");
  }

  const schemas = getAllSchemas();
  const openapiSpecs = await jsonSchemasToOpenAPIs(schemas);
  await updateSummary(openapiSpecs);
  await updateGitBookOpenAPIs(openapiSpecs, GITBOOK_TOKEN, GITBOOK_ORG_ID);

  console.log("==".repeat(40));
  console.log(`Process completed successfully`);
  console.log("==".repeat(40));
}
