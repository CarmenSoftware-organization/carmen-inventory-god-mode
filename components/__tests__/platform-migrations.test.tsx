import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CATALOG } from "@/lib/platform-migrations";
import { PlatformMigrations } from "@/components/platform-migrations";

vi.mock("@/components/use-operation-stream", () => ({
  useOperationStream: () => ({ state: { phase: "idle", done: 0 }, start: vi.fn() }),
}));

afterEach(cleanup);

const props = {
  target: { masked: "postgresql://u@h/carmen_platform", database: "carmen_platform", schema: "CARMEN_SYSTEM" },
  catalog: CATALOG,
  buCodes: ["T03"],
  tenantFiles: ["001_v_operational_product_list.up.sql"],
  schemas: ["CARMEN_SYSTEM"],
  defaultSchema: "CARMEN_SYSTEM",
};

test("shows the masked target DB banner", () => {
  render(<PlatformMigrations {...props} />);
  expect(screen.getByText(/carmen_platform/)).toBeInTheDocument();
  expect(screen.queryByText(/:s3cret@|:p@/)).not.toBeInTheDocument();
});

test("read-only op enables Run immediately", () => {
  render(<PlatformMigrations {...props} />);
  fireEvent.click(screen.getByLabelText(/Prisma: migration status/i));
  expect(screen.getByRole("button", { name: /^Run$/i })).toBeEnabled();
});

test("write op keeps Run disabled until the schema name is typed", () => {
  render(<PlatformMigrations {...props} />);
  fireEvent.click(screen.getByLabelText(/apply pending migrations/i));
  const run = screen.getByRole("button", { name: /^Run$/i });
  expect(run).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: "CARMEN_SYSTEM" } });
  expect(run).toBeEnabled();
});

test("destructive op also requires the destroy checkbox", () => {
  render(<PlatformMigrations {...props} />);
  fireEvent.click(screen.getByLabelText(/prisma migrate reset/i));
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: "CARMEN_SYSTEM" } });
  const run = screen.getByRole("button", { name: /^Run$/i });
  expect(run).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/destroys data/i));
  expect(run).toBeEnabled();
});

test("shows the npm script and .ts file under an op label", () => {
  render(<PlatformMigrations {...props} scriptInfo={{
    "seed-permission": { script: "db:seed.permission", file: "seed.permission.ts", missing: false },
  }} />);
  expect(screen.getByText("db:seed.permission · seed.permission.ts")).toBeInTheDocument();
});

test("shows the script name only when there is no .ts file", () => {
  render(<PlatformMigrations {...props} scriptInfo={{
    "prisma-deploy": { script: "db:deploy", file: null, missing: false },
  }} />);
  expect(screen.getByText("db:deploy")).toBeInTheDocument();
  expect(screen.queryByText(/·/)).not.toBeInTheDocument();
});

test("flags an op whose script is missing from the package", () => {
  render(<PlatformMigrations {...props} scriptInfo={{
    "seed-permission": { script: "db:seed.permission", file: null, missing: true },
  }} />);
  expect(screen.getByText(/not in package/i)).toBeInTheDocument();
});

test("renders the label only when an op has no scriptInfo entry", () => {
  render(<PlatformMigrations {...props} scriptInfo={{}} />);
  expect(screen.getByText("Seed: baseline")).toBeInTheDocument();
  expect(screen.queryByText(/not in package/i)).not.toBeInTheDocument();
});
