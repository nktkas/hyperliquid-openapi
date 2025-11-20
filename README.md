# Hyperliquid OpenAPI

OpenAPI for [Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) based on
[TypeScript SDK](https://github.com/nktkas/hyperliquid)

## Features

- **Auto-synced**: Automatically updated via [CI](https://github.com/nktkas/hyperliquid-openapi/actions) when the [TypeScript SDK](https://github.com/nktkas/hyperliquid/releases) changes
- **Complete coverage**: Full set of Hyperliquid APIs, including undocumented endpoints
- **AI-integrated**: Native GitBook MCP support for AI assistant integration

## Known issues

- OpenAPI in GitBook does not display the array-in-array schema; instead, it displays `any[][]` (when getting OpenAPI directly (e.g., using the "Copy" button), the schema is correct)
