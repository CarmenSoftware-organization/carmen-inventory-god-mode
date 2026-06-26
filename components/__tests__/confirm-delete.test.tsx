import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { BlastRadius } from "@/lib/cascade";

afterEach(cleanup);

const radius: BlastRadius = {
  rows: [{ schema: "CARMEN_SYSTEM", table: "tb_cluster", pk: { id: "1" }, depth: 0 }],
  byTable: [{ schema: "CARMEN_SYSTEM", table: "tb_cluster", count: 1 }],
  maxDepth: 0, truncated: false,
};

test("renders an orphan-schemas drop checkbox listing each schema", async () => {
  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} action={vi.fn()} isBusinessUnit={false} tenantSchema={null}
    orphanSchemas={["tenant_one", "tenant_two"]} requiredPhrase="DELETE" />);
  const box = screen.getByRole("checkbox");
  expect(box).toHaveAttribute("name", "drop_schema");
  expect(screen.getByText(/tenant_one/)).toBeInTheDocument();
  expect(screen.getByText(/tenant_two/)).toBeInTheDocument();
});

test("no orphan checkbox when orphanSchemas is empty/absent", async () => {
  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} action={vi.fn()} isBusinessUnit={false} tenantSchema={null}
    requiredPhrase="DELETE" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
