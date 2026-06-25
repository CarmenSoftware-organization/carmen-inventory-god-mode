import { render, screen } from "@testing-library/react";
import { expect, test, beforeAll } from "vitest";
import "@testing-library/jest-dom/vitest";
beforeAll(() => {
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
});

test("system schema shows SYSTEM warning", async () => {
  const { SchemaBanner } = await import("@/components/schema-banner");
  render(<SchemaBanner schema="CARMEN_SYSTEM" />);
  expect(screen.getByText(/SYSTEM/)).toBeInTheDocument();
});

test("tenant schema shows its name", async () => {
  const { SchemaBanner } = await import("@/components/schema-banner");
  render(<SchemaBanner schema="BL_FIFO" />);
  expect(screen.getByText(/BL_FIFO/)).toBeInTheDocument();
});

test("null schema renders nothing", async () => {
  const { SchemaBanner } = await import("@/components/schema-banner");
  const { container } = render(<SchemaBanner schema={null} />);
  expect(container).toBeEmptyDOMElement();
});
